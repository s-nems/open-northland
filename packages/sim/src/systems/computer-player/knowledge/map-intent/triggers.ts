import type { MapAiCondition, MapAiSeat } from '@open-northland/data';
import { TICKS_PER_SECOND } from '../../../../core/loop.js';
import type { MissionGoalOp, MissionScript } from '../../../missions/script.js';
import { SUCCESSFUL_IF } from '../../../missions/script.js';

/** A half-cell node, the unit both a mission point and a map-AI position are written in. */
export interface IntentPoint {
  readonly hx: number;
  readonly hy: number;
}

/** How the conditions of a {@link Trigger} combine: the mission rules, `notAny` for the map AI's
 *  "not the first" combinator. */
export type TriggerMatch = 'all' | 'any' | 'half' | 'notAny';

/**
 * When a scripted event happens, in ticks after the map starts. `atTick` is exact (timers chained from
 * a known activation), `window` a bounded random span (`RandomTimeGone`), `conditional` waits on world
 * state. `repeats` marks an event whose mission re-activates itself through its own chain. A mission
 * timer is the earliest tick: the evaluation cadence adds up to one pass more.
 */
export type Trigger =
  | { readonly kind: 'always' }
  | { readonly kind: 'never' }
  | { readonly kind: 'atTick'; readonly tick: number; readonly repeats: boolean }
  | { readonly kind: 'window'; readonly fromTick: number; readonly toTick: number; readonly repeats: boolean }
  | {
      readonly kind: 'conditional';
      readonly match: TriggerMatch;
      readonly conditions: readonly TriggerCondition[];
    };

/** One world-state test a conditional trigger waits on; player 20 on a range test is any player. */
export type TriggerCondition =
  | { readonly kind: 'nested'; readonly trigger: Trigger }
  /** A wait that starts when the conditions before it in an `all` group hold. */
  | { readonly kind: 'delay'; readonly fromTicks: number; readonly toTicks: number }
  | {
      readonly kind: 'unitsInRange';
      readonly player: number;
      readonly point: IntentPoint;
      readonly range: number;
      readonly soldiersOnly: boolean;
      readonly minUnits: number;
    }
  | {
      readonly kind: 'housesInRange';
      readonly player: number;
      readonly point: IntentPoint;
      readonly range: number;
      /** 0 for any type. */
      readonly houseType: number;
    }
  | { readonly kind: 'soldierCount'; readonly player: number; readonly count: number }
  /** A map-AI slot a mission's `SetExternalFlag` raises, with when those missions fire. */
  | {
      readonly kind: 'externalFlag';
      readonly player: number;
      readonly slot: number;
      readonly raisedBy: Trigger;
    }
  | { readonly kind: 'mission'; readonly mission: number; readonly state: 'done' | 'active' }
  | { readonly kind: 'playerSeen'; readonly seer: number; readonly seen: number }
  | { readonly kind: 'playerDead'; readonly player: number }
  | { readonly kind: 'diplomacy'; readonly from: number; readonly to: number; readonly state: string }
  | {
      readonly kind: 'conditionChange';
      readonly player: number;
      readonly slot: number;
      readonly delayTicks: number;
    }
  /** Any other goal, by opcode. */
  | { readonly kind: 'goal'; readonly opcode: string };

const ALWAYS: Trigger = { kind: 'always' };
const NEVER: Trigger = { kind: 'never' };
const AT_START: Trigger = { kind: 'atTick', tick: 0, repeats: false };

/** The loader's two fixed condition answers (`docs/formats/MISSIONS.md`, AI data). */
const SLOT_ALWAYS = 100000;
const SLOT_NEVER = 100001;
/** The `OnConditions` combinators: all of, any of, not the first, either of the first two. */
const MODE_ALL = 1;
const MODE_ANY = 2;
const MODE_NOT_FIRST = 3;
const MODE_EITHER_OF_TWO = 4;
const EITHER_OF_TWO_SLOTS = 2;
/** How deep a trigger nests other missions' triggers before it names the mission instead. Authored:
 *  deep enough for the five reference maps' chains, shallow enough for a debug view to read. */
const MAX_TRIGGER_DEPTH = 6;

/** A pure delay after an activation: exact (`fromTicks === toTicks`) or a random span. */
interface Delay {
  readonly fromTicks: number;
  readonly toTicks: number;
}

function isTimed(t: Trigger): t is Extract<Trigger, { kind: 'atTick' | 'window' }> {
  return t.kind === 'atTick' || t.kind === 'window';
}

function timedSpan(t: Extract<Trigger, { kind: 'atTick' | 'window' }>): Delay {
  return t.kind === 'atTick'
    ? { fromTicks: t.tick, toTicks: t.tick }
    : { fromTicks: t.fromTick, toTicks: t.toTick };
}

function timedOf(span: Delay, repeats: boolean): Trigger {
  return span.fromTicks === span.toTicks
    ? { kind: 'atTick', tick: span.fromTicks, repeats }
    : { kind: 'window', fromTick: span.fromTicks, toTick: span.toTicks, repeats };
}

function repeatsOf(t: Trigger): boolean {
  return isTimed(t) && t.repeats;
}

/** The earliest of alternative triggers: whichever happens first. */
function anyOf(options: readonly Trigger[]): Trigger {
  if (options.some((t) => t.kind === 'always')) return ALWAYS;
  const live = options.filter((t) => t.kind !== 'never');
  if (live.length === 0) return NEVER;
  if (live.length === 1) return live[0] ?? NEVER;
  if (live.every(isTimed)) {
    const spans = live.map(timedSpan);
    return timedOf(
      {
        fromTicks: Math.min(...spans.map((s) => s.fromTicks)),
        toTicks: Math.min(...spans.map((s) => s.toTicks)),
      },
      live.some(repeatsOf),
    );
  }
  return conditional('any', live.map(nest));
}

/** All of the triggers: the latest timed part, with the untimed ones as conditions. */
function allOf(parts: readonly Trigger[]): Trigger {
  if (parts.some((t) => t.kind === 'never')) return NEVER;
  const live = parts.filter((t) => t.kind !== 'always');
  if (live.length === 0) return ALWAYS;
  if (live.length === 1) return live[0] ?? ALWAYS;
  if (live.every(isTimed)) {
    const spans = live.map(timedSpan);
    return timedOf(
      {
        fromTicks: Math.max(...spans.map((s) => s.fromTicks)),
        toTicks: Math.max(...spans.map((s) => s.toTicks)),
      },
      live.some(repeatsOf),
    );
  }
  return conditional('all', live.map(nest));
}

/** `delay` waited out after `first`: shifted when `first` is timed, a trailing delay otherwise. */
function after(first: Trigger, delay: Delay, repeats: boolean): Trigger {
  if (first.kind === 'never') return NEVER;
  if (first.kind === 'always') return timedOf(delay, repeats);
  if (isTimed(first)) {
    const span = timedSpan(first);
    return timedOf(
      { fromTicks: span.fromTicks + delay.fromTicks, toTicks: span.toTicks + delay.toTicks },
      repeats || first.repeats,
    );
  }
  if (delay.toTicks === 0) return first;
  return conditional('all', [nest(first), { kind: 'delay', ...delay }]);
}

function nest(t: Trigger): TriggerCondition {
  return { kind: 'nested', trigger: t };
}

/** A conditional, with same-match nested groups spliced into it. */
function conditional(match: TriggerMatch, conditions: readonly TriggerCondition[]): Trigger {
  const flat: TriggerCondition[] = [];
  for (const c of conditions) {
    if (
      match !== 'notAny' &&
      c.kind === 'nested' &&
      c.trigger.kind === 'conditional' &&
      c.trigger.match === match
    ) {
      flat.push(...c.trigger.conditions);
    } else flat.push(c);
  }
  return { kind: 'conditional', match, conditions: flat };
}

function single(condition: TriggerCondition): Trigger {
  return { kind: 'conditional', match: 'all', conditions: [condition] };
}

/** `RandomTimeGone n` draws `n/2 + rand % (n/2)` whole seconds (`docs/formats/MISSIONS.md`). */
function randomSpan(seconds: number): Delay {
  const half = Math.trunc(seconds / 2);
  return { fromTicks: half * TICKS_PER_SECOND, toTicks: Math.max(half, 2 * half - 1) * TICKS_PER_SECOND };
}

/**
 * When each mission of a script fires, as far as the script alone says. Activation chains are followed
 * backwards; a chain that loops back onto a mission marks it repeating instead of recursing.
 * `DeactivateMission` and `DisableAll` are not modelled, so a fire time is the earliest possible one.
 */
export class MissionTiming {
  private readonly activators: readonly (readonly number[])[];
  private readonly flagRaisers = new Map<string, number[]>();
  private readonly loops: readonly boolean[];
  private readonly fired = new Map<number, Trigger>();
  private readonly stack = new Set<number>();
  /** Bumped whenever a chain is cut short (a loop or the depth cap): a result computed across a cut
   *  depends on where the walk entered, so only an uncut one is cached. */
  private cuts = 0;

  constructor(private readonly script: MissionScript) {
    const activators: number[][] = script.missions.map(() => []);
    script.missions.forEach((mission, index) => {
      for (const result of mission.results) {
        if (result.opcode === 'ActivateMission') activators[result.missionIndex]?.push(index);
        if (result.opcode === 'SetExternalFlag' && result.flag) {
          const key = flagKey(result.player, result.flagId);
          const raisers = this.flagRaisers.get(key) ?? [];
          if (!raisers.includes(index)) raisers.push(index);
          this.flagRaisers.set(key, raisers);
        }
      }
    });
    this.activators = activators;
    this.loops = script.missions.map((_, index) => reachesItself(activators, index));
  }

  /** The missions whose results activate `mission`, ascending. */
  activatorsOf(mission: number): readonly number[] {
    return this.activators[mission] ?? [];
  }

  /** When `mission` first fires its results. */
  fireOf(mission: number, depth = 0): Trigger {
    const held = this.fired.get(mission);
    if (held !== undefined) return held;
    if (this.stack.has(mission) || depth > MAX_TRIGGER_DEPTH) {
      this.cuts++;
      return single({ kind: 'mission', mission, state: 'done' });
    }
    const cutsBefore = this.cuts;
    this.stack.add(mission);
    const result = this.computeFire(mission, depth);
    this.stack.delete(mission);
    if (this.cuts === cutsBefore) this.fired.set(mission, result);
    return result;
  }

  /** When the missions that raise map-AI slot `slot` of `player` fire. */
  flagRaisedBy(player: number, slot: number, depth = 0): Trigger {
    const raisers = this.flagRaisers.get(flagKey(player, slot)) ?? [];
    return anyOf(raisers.map((m) => this.fireOf(m, depth + 1)));
  }

  private computeFire(mission: number, depth: number): Trigger {
    const def = this.script.missions[mission];
    if (def === undefined) return NEVER;
    const repeats = this.loops[mission] ?? false;
    const activation = def.active ? AT_START : this.activationOf(mission, depth);
    const goals = this.goalsTrigger(def.successfullIf, def.goals, depth);
    if (goals.kind === 'delay') return after(activation, goals, repeats);
    if (goals.trigger.kind === 'never') return NEVER;
    if (activation.kind === 'atTick' && activation.tick === 0 && !repeats) return goals.trigger;
    return allOf([activation, goals.trigger]);
  }

  /** The earliest activator's fire; an activator already on the walk is a loop, cut here. */
  private activationOf(mission: number, depth: number): Trigger {
    const activators = this.activatorsOf(mission);
    const open = activators.filter((a) => !this.stack.has(a));
    if (open.length < activators.length) this.cuts++;
    return anyOf(open.map((a) => this.fireOf(a, depth + 1)));
  }

  /** A mission's goals under its rule: a pure delay when only timers decide it. */
  private goalsTrigger(
    rule: number,
    goals: readonly MissionGoalOp[],
    depth: number,
  ): ({ readonly kind: 'delay' } & Delay) | { readonly kind: 'trigger'; readonly trigger: Trigger } {
    const delays: Delay[] = [];
    const conditions: TriggerCondition[] = [];
    for (const goal of goals) {
      const read = this.goalPart(goal, depth);
      if (read === null) delays.push({ fromTicks: 0, toTicks: 0 });
      else if ('fromTicks' in read) delays.push(read);
      else conditions.push(read);
    }
    switch (rule) {
      case SUCCESSFUL_IF.all:
        if (conditions.length === 0) return { kind: 'delay', ...latest(delays) };
        if (delays.some((d) => d.toTicks > 0)) conditions.push({ kind: 'delay', ...latest(delays) });
        return { kind: 'trigger', trigger: conditional('all', conditions) };
      case SUCCESSFUL_IF.any:
        if (delays.length > 0) return { kind: 'delay', ...earliest(delays) };
        if (conditions.length === 0) return { kind: 'trigger', trigger: NEVER };
        return { kind: 'trigger', trigger: conditional('any', conditions) };
      case SUCCESSFUL_IF.half:
      case SUCCESSFUL_IF.none:
        if (goals.length === 0) return { kind: 'delay', fromTicks: 0, toTicks: 0 };
        return {
          kind: 'trigger',
          trigger: conditional(rule === SUCCESSFUL_IF.half ? 'half' : 'notAny', [
            ...conditions,
            ...delays.map((d): TriggerCondition => ({ kind: 'delay', ...d })),
          ]),
        };
      default:
        return { kind: 'trigger', trigger: NEVER };
    }
  }

  /** A goal as a delay, a condition, or null for one that always holds. */
  private goalPart(goal: MissionGoalOp, depth: number): Delay | TriggerCondition | null {
    switch (goal.opcode) {
      case 'True':
        return null;
      case 'TimeGone':
        return { fromTicks: goal.seconds * TICKS_PER_SECOND, toTicks: goal.seconds * TICKS_PER_SECOND };
      case 'RandomTimeGone':
        return randomSpan(goal.seconds);
      case 'IsMissionDone':
      case 'CheckMission':
        return nest(this.fireOf(goal.missionIndex, depth + 1));
      case 'IfMissionIsActive':
        return { kind: 'mission', mission: goal.missionIndex, state: 'active' };
      default:
        return conditionOfGoal(goal);
    }
  }
}

function latest(delays: readonly Delay[]): Delay {
  return {
    fromTicks: Math.max(0, ...delays.map((d) => d.fromTicks)),
    toTicks: Math.max(0, ...delays.map((d) => d.toTicks)),
  };
}

function earliest(delays: readonly Delay[]): Delay {
  return {
    fromTicks: Math.min(...delays.map((d) => d.fromTicks)),
    toTicks: Math.min(...delays.map((d) => d.toTicks)),
  };
}

/** Whether an activation chain leads from `mission` back to itself. */
function reachesItself(activators: readonly (readonly number[])[], mission: number): boolean {
  const seen = new Set<number>();
  const open = [...(activators[mission] ?? [])];
  while (open.length > 0) {
    const next = open.pop();
    if (next === undefined || seen.has(next)) continue;
    if (next === mission) return true;
    seen.add(next);
    open.push(...(activators[next] ?? []));
  }
  return false;
}

function flagKey(player: number, slot: number): string {
  return `${player}:${slot}`;
}

/** A world-state goal as the condition a trigger waits on. */
function conditionOfGoal(goal: MissionGoalOp): TriggerCondition {
  switch (goal.opcode) {
    case 'FindPosByPlayersMapMoveable':
      return {
        kind: 'unitsInRange',
        player: goal.player,
        point: goal.point,
        range: goal.range,
        soldiersOnly: false,
        minUnits: 1,
      };
    case 'NumberOfSoldiersNearPos':
      return {
        kind: 'unitsInRange',
        player: goal.player,
        point: goal.point,
        range: goal.range,
        soldiersOnly: true,
        minUnits: goal.amount,
      };
    case 'NumberOfHousesInArea':
      return {
        kind: 'housesInRange',
        player: goal.player,
        point: goal.point,
        range: goal.range,
        houseType: goal.houseType,
      };
    case 'NumberOfSoldiers':
      return { kind: 'soldierCount', player: goal.player, count: goal.amount };
    case 'PlayerSeen':
      return { kind: 'playerSeen', seer: goal.player, seen: goal.otherPlayer };
    case 'PlayerDied':
      return { kind: 'playerDead', player: goal.player };
    case 'DiplomacyState':
      return { kind: 'diplomacy', from: goal.player, to: goal.otherPlayer, state: goal.state ?? 'unknown' };
    default:
      return { kind: 'goal', opcode: goal.opcode };
  }
}

/**
 * When a map-AI condition slot of `seat` first holds, resolved through its `OnConditions` combinators
 * and, for an external slot, the missions that raise it.
 */
export function slotTrigger(seat: MapAiSeat, slot: number, timing: MissionTiming | null): Trigger {
  return resolveSlot(seat, slot, timing, new Set());
}

function resolveSlot(
  seat: MapAiSeat,
  slot: number,
  timing: MissionTiming | null,
  open: Set<number>,
): Trigger {
  if (slot === SLOT_ALWAYS) return ALWAYS;
  if (slot === SLOT_NEVER || open.has(slot)) return NEVER;
  // The first declaration of a slot wins.
  const condition = seat.conditions.find((c) => c.slot === slot);
  if (condition === undefined) return NEVER;
  open.add(slot);
  const resolved = resolveCondition(seat, condition, timing, open);
  open.delete(slot);
  return resolved;
}

function resolveCondition(
  seat: MapAiSeat,
  condition: MapAiCondition,
  timing: MissionTiming | null,
  open: Set<number>,
): Trigger {
  const player = seat.player;
  switch (condition.kind) {
    case 'true':
      return ALWAYS;
    case 'onTime':
      return { kind: 'atTick', tick: condition.ticks, repeats: false };
    case 'onTimer':
      return { kind: 'atTick', tick: condition.delayTicks, repeats: true };
    case 'onExternal':
      return single({
        kind: 'externalFlag',
        player,
        slot: condition.slot,
        raisedBy: timing === null ? NEVER : timing.flagRaisedBy(player, condition.slot),
      });
    case 'onConditions': {
      const children = (slots: readonly number[]) => slots.map((s) => resolveSlot(seat, s, timing, open));
      if (condition.mode === MODE_ALL) return allOf(children(condition.slots));
      if (condition.mode === MODE_ANY) return anyOf(children(condition.slots));
      if (condition.mode === MODE_EITHER_OF_TWO)
        return anyOf(children(condition.slots.slice(0, EITHER_OF_TWO_SLOTS)));
      if (condition.mode === MODE_NOT_FIRST) {
        const first = children(condition.slots.slice(0, 1))[0] ?? NEVER;
        if (first.kind === 'never') return ALWAYS;
        if (first.kind === 'always') return NEVER;
        return { kind: 'conditional', match: 'notAny', conditions: [nest(first)] };
      }
      return NEVER;
    }
    case 'onConditionChangeDelayed':
      return single({
        kind: 'conditionChange',
        player,
        slot: condition.source,
        delayTicks: condition.delayTicks,
      });
    case 'onDiplomacyChange':
      return single({
        kind: 'diplomacy',
        from: condition.from,
        to: condition.to,
        state: String(condition.state),
      });
    case 'onCreatureInRange':
      return single({
        kind: 'unitsInRange',
        player: condition.player,
        point: { hx: condition.x, hy: condition.y },
        range: condition.range,
        soldiersOnly: condition.soldiersOnly,
        minUnits: 1,
      });
    case 'onHouseInRange':
      return single({
        kind: 'housesInRange',
        player: condition.player,
        point: { hx: condition.x, hy: condition.y },
        range: condition.range,
        houseType: condition.houseType,
      });
    case 'onPlayerSeen':
      return single({ kind: 'playerSeen', seer: condition.seer, seen: condition.seen });
    case 'onPlayerDead':
      return single({ kind: 'playerDead', player: condition.player });
    case 'onNumberOfSoldiers':
      return single({ kind: 'soldierCount', player: condition.player, count: condition.count });
  }
}
