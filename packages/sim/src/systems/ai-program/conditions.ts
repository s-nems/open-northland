import { MAP_AI_CONDITION_SLOTS, type MapAiCondition } from '@open-northland/data';
import {
  AI_TICK_NEVER,
  type AiConditionRecord,
  aiExternalFlagRaised,
  Building,
  type DiplomacyState,
  diplomacyStance,
  hasMetContact,
  Owner,
  Position,
  Settler,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween, nodeOfPosition } from '../../nav/halfcell.js';
import { isBuilt, ownedSettlers } from '../ai-player/seat-roster.js';
import type { SystemContext } from '../context.js';
import { isFighterJob } from '../readviews/index.js';

// The condition slots of one seat's program: the readings of the the original's
// `an original routine`, `Condition_RecheckAll`,
// `Condition_IsActive` and `an original routine` (`docs/formats/MISSIONS.md`, AI data).

/** The two fixed condition references a task or an `OnConditions` slot may name instead of a slot. */
export const CONDITION_ALWAYS = 100000;
export const CONDITION_NEVER = 100001;

/** The player a range condition names to mean any player. */
export const ANY_PLAYER = 20;

/** The `Diplomacy_GetState` codes the script writes; the enemies-only range tests compare against
 *  the third. */
const DIPLOMACY_BY_CODE: Readonly<Record<number, DiplomacyState>> = { 1: 'friend', 2: 'neutral', 3: 'enemy' };

/** The `OnConditions` combinators. */
const ALL_OF = 1;
const ANY_OF = 2;
const NOT_THE_ONE = 3;
const EITHER_OF_TWO = 4;

/** Handler turns between rechecks: a scan over the map's creatures or houses every tenth turn, every
 *  other kind every turn. */
const RANGE_SCAN_TURNS = 10;
/** A recheck repeats while a pass changed something, this many passes at most. */
const RECHECK_PASSES = 10;
/** `OnPlayerDead` is not judged before this tick. */
const PLAYER_DEAD_AFTER_TICK = 720;
/** The tick an `OnTimer` counts its first delay from: the program loads with the map. */
const PROGRAM_LOAD_TICK = 0;

/** Whether a task or `OnConditions` reference holds: the fixed answers, else a declared slot's state. */
export function conditionActive(records: readonly (AiConditionRecord | null)[], ref: number): boolean {
  if (ref === CONDITION_ALWAYS) return true;
  if (ref === CONDITION_NEVER || ref >= MAP_AI_CONDITION_SLOTS) return false;
  return records[ref]?.active ?? false;
}

/** The program's declared conditions by slot, first declaration winning as the loader refuses a slot
 *  already set; a slot nothing declares is null. */
export function conditionsBySlot(script: readonly MapAiCondition[]): (MapAiCondition | null)[] {
  const bySlot: (MapAiCondition | null)[] = [];
  for (const def of script) {
    if (def.slot >= MAP_AI_CONDITION_SLOTS || bySlot[def.slot] != null) continue;
    while (bySlot.length <= def.slot) bySlot.push(null);
    bySlot[def.slot] = def;
  }
  return bySlot;
}

export function freshConditionRecord(): AiConditionRecord {
  return { active: false, activatedTick: AI_TICK_NEVER, deactivatedTick: AI_TICK_NEVER };
}

/**
 * Re-judge every slot due on `turn`, repeating while a pass changed a slot (a slot that reads others
 * settles within the same turn), and say whether any slot changed. Turn 0 judges every slot.
 */
export function recheckConditions(
  world: World,
  ctx: SystemContext,
  seat: number,
  bySlot: readonly (MapAiCondition | null)[],
  records: (AiConditionRecord | null)[],
  turn: number,
): boolean {
  let changedAny = false;
  for (let pass = 0; pass < RECHECK_PASSES; pass++) {
    let changed = false;
    for (let slot = 0; slot < bySlot.length; slot++) {
      const def = bySlot[slot];
      const record = records[slot];
      if (def == null || record == null) continue;
      if (turn !== 0 && turn % recheckTurns(def) !== 0) continue;
      const verdict = judge(world, ctx, seat, def, records);
      if (verdict === undefined) continue;
      if (setCondition(record, isSticky(def), verdict, ctx.tick)) changed = true;
    }
    changedAny ||= changed;
    if (!changed) break;
  }
  return changedAny;
}

function recheckTurns(def: MapAiCondition): number {
  return def.kind === 'onCreatureInRange' || def.kind === 'onHouseInRange' ? RANGE_SCAN_TURNS : 1;
}

/** A sticky slot never falls back once it has held: the line's flag, fixed on for the three kinds
 *  that carry none and off for the external flag and the timer. */
function isSticky(def: MapAiCondition): boolean {
  switch (def.kind) {
    case 'true':
    case 'onTime':
    case 'onPlayerDead':
      return true;
    case 'onExternal':
    case 'onTimer':
      return false;
    default:
      return def.sticky;
  }
}

/** Write `value` over the record when it differs and the slot may still change; the change's tick is
 *  kept for the delayed and timer kinds. True when the record changed. */
function setCondition(record: AiConditionRecord, sticky: boolean, value: boolean, tick: number): boolean {
  if (record.active === value || (record.active && sticky)) return false;
  record.active = value;
  if (value) record.activatedTick = tick;
  else record.deactivatedTick = tick;
  return true;
}

/** The slot's verdict now, or undefined for a kind that leaves the slot as it is this turn. */
function judge(
  world: World,
  ctx: SystemContext,
  seat: number,
  def: MapAiCondition,
  records: readonly (AiConditionRecord | null)[],
): boolean | undefined {
  switch (def.kind) {
    case 'true':
      return true;
    case 'onTime':
      return ctx.tick >= def.ticks;
    case 'onConditions':
      return combine(def.mode, def.slots, records);
    case 'onConditionChangeDelayed': {
      const source = records[def.source];
      if (source == null) return false;
      const since = def.onActivation ? source.activatedTick : source.deactivatedTick;
      return since !== AI_TICK_NEVER && ctx.tick >= since + def.delayTicks;
    }
    case 'onDiplomacyChange':
      return diplomacyStance(world, def.from, def.to) === DIPLOMACY_BY_CODE[def.state];
    case 'onCreatureInRange':
      return creatureInRange(world, ctx, seat, def);
    case 'onHouseInRange':
      return houseInRange(world, seat, def);
    case 'onPlayerSeen':
      return hasMetContact(world, def.seer, def.seen);
    case 'onPlayerDead':
      if (ctx.tick <= PLAYER_DEAD_AFTER_TICK) return undefined;
      return ownedSettlers(world, def.player).length === 0;
    case 'onNumberOfSoldiers':
      return def.count <= soldierCount(world, ctx, def.player);
    case 'onExternal':
      return aiExternalFlagRaised(world, seat, def.slot);
    case 'onTimer': {
      const record = records[def.slot];
      if (record == null) return undefined;
      if (record.active) return ctx.tick < record.activatedTick + def.activeTicks;
      const since =
        record.activatedTick === AI_TICK_NEVER
          ? PROGRAM_LOAD_TICK + def.delayTicks
          : record.deactivatedTick + def.inactiveTicks;
      return ctx.tick > since;
    }
  }
}

/** `OnConditions`: the referenced slots under the line's combinator; a mode the loader does not know
 *  leaves the slot alone. */
function combine(
  mode: number,
  slots: readonly number[],
  records: readonly (AiConditionRecord | null)[],
): boolean | undefined {
  const active = (ref: number): boolean => conditionActive(records, ref);
  const [first, second] = slots;
  switch (mode) {
    case ALL_OF:
      return slots.every(active);
    case ANY_OF:
      return slots.some(active);
    case NOT_THE_ONE:
      return first === undefined ? true : !active(first);
    case EITHER_OF_TWO:
      return (first !== undefined && active(first)) !== (second !== undefined && active(second));
    default:
      return undefined;
  }
}

/** A human of another player (or of the seat itself when the line names it) standing inside the
 *  range, narrowed to enemies and to soldiers as the line asks. Approximation: the original also
 *  counts owned animals and vehicles, which this build's seats do not field in a fight. */
function creatureInRange(
  world: World,
  ctx: SystemContext,
  seat: number,
  def: Extract<MapAiCondition, { kind: 'onCreatureInRange' }>,
): boolean {
  for (const e of world.query(Settler, Owner, Position)) {
    const owner = world.get(e, Owner).player;
    if (owner === seat && def.player !== seat) continue;
    if (def.player !== ANY_PLAYER && def.player !== owner) continue;
    if (def.enemiesOnly && diplomacyStance(world, seat, owner) !== 'enemy') continue;
    if (def.soldiersOnly && !isSoldier(world, ctx, e)) continue;
    if (inRange(world, e, def.x, def.y, def.range)) return true;
  }
  return false;
}

/** A house of the named player (any but the seat's own for 20) inside the range, of the named type
 *  when one is named, finished when asked, and of an enemy when asked. */
function houseInRange(
  world: World,
  seat: number,
  def: Extract<MapAiCondition, { kind: 'onHouseInRange' }>,
): boolean {
  for (const e of world.query(Building, Owner, Position)) {
    const owner = world.get(e, Owner).player;
    if (def.player === ANY_PLAYER ? owner === seat : owner !== def.player) continue;
    if (def.finishedOnly && !isBuilt(world, e)) continue;
    if (def.houseType !== 0 && world.get(e, Building).buildingType !== def.houseType) continue;
    if (def.enemiesOnly && diplomacyStance(world, seat, owner) !== 'enemy') continue;
    if (inRange(world, e, def.x, def.y, def.range)) return true;
  }
  return false;
}

function inRange(world: World, e: Entity, hx: number, hy: number, range: number): boolean {
  const at = world.get(e, Position);
  const node = nodeOfPosition(at.x, at.y);
  return hexDistanceBetween(node.hx, node.hy, hx, hy) < range;
}

function isSoldier(world: World, ctx: SystemContext, e: Entity): boolean {
  const jobType = world.get(e, Settler).jobType;
  return jobType !== null && isFighterJob(ctx.content, jobType);
}

/** The soldiers a player fields, as its statistics count them. */
export function soldierCount(world: World, ctx: SystemContext, player: number): number {
  let count = 0;
  for (const e of ownedSettlers(world, player)) if (isSoldier(world, ctx, e)) count++;
  return count;
}
