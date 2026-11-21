import type { MapAiSeat, MapAiTask } from '@open-northland/data';
import {
  AiOrder,
  Building,
  computerModuleRuns,
  isPlayerDead,
  isScriptedEconomySeat,
  type MapAiDefaultPosition,
  type MapAiHouseRecord,
  MapAiState,
  type MapAiWallRecord,
  mapAiEntity,
  Position,
  setAiExternalFlag,
} from '../../components/index.js';
import { aiCommand, type PlayerCommand } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { handlerTurn, mapAiSeatOnTurn } from '../ai-shared/cadence.js';
import { takeCensus } from '../ai-shared/military/census.js';
import { towerPostOrders } from '../ai-shared/military/defence/index.js';
import { type Raider, seatRaiders } from '../ai-shared/military/defence/threat.js';
import { mapAiSoldierClaims, releaseCampaignClaims } from '../ai-shared/military/ownership.js';
import { ownedBuildings, ownedSettlers } from '../ai-shared/seat-roster.js';
import type { System, SystemContext } from '../context.js';
import { withdrawAiEntityOrder } from '../orders/ai-lifecycle.js';
import { type CatapultDecision, catapultOrders } from './catapults.js';
import { CONDITION_ALWAYS, conditionsBySlot, freshConditionRecord, recheckConditions } from './conditions.js';
import { familyOrders } from './families.js';
import { rebuildList, rebuildOrders } from './rebuild.js';
import { assignSoldiers, clearInvalidTasks, updateSoldierList, workOrders } from './soldiers.js';
import { activeGroups, freshTaskRecord, recheckTasks } from './tasks.js';
import { holdTownGoods, townStaffingOrders } from './town.js';
import { wallList, wallRebuildOrders } from './walls.js';

/**
 * The scripted handler's program (`docs/formats/MISSIONS.md`, AI data): on a computer seat's handler
 * turn, judge its condition slots, re-judge its tasks when a slot changed, run the one-shots, keep its
 * soldier list and crew its catapults, hand the men to the Defend and Attack groups on every second
 * turn and order them on every turn, then keep the town ({@link townOrders}). The rows come from the
 * map (`ctx.mapAiScript`); the state is the seat's `MapAiState`.
 *
 * Map tasks reserve their soldiers before autonomous decisions. Original behavior: a player's death
 * turns both handlers off, so a seat the match marked dead skips its turn (a reading, unconfirmed
 * against the running original).
 */
export const mapAiSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return;
  const seat = mapAiSeatOnTurn(world, ctx.tick);
  if (seat === null || isPlayerDead(world, seat)) return;
  const script = ctx.mapAiScript?.find((row) => row.player === seat);
  const turn = handlerTurn(ctx.tick);
  const carrier = mapAiEntity(world, seat) ?? startProgram(world, ctx, terrain, seat, script);
  const program = world.mut(carrier, MapAiState);
  const autonomous = computerModuleRuns(world, seat, 'military');
  const defs = taskDefs(script, autonomous ? null : program.defaultDefend);
  const bySlot = conditionsBySlot(script?.conditions ?? []);
  const first = program.conditions.length === 0 && bySlot.length > 0;
  if (first) program.conditions = bySlot.map((def) => (def === null ? null : freshConditionRecord()));
  const changed = recheckConditions(world, ctx, seat, bySlot, program.conditions, turn);
  const recheck = changed || turn === 0 || program.tasks.length !== defs.length;
  if (recheck) {
    if (program.tasks.length > defs.length) program.tasks.length = defs.length;
    while (program.tasks.length < defs.length) program.tasks.push(freshTaskRecord());
    recheckTasks(world, ctx, seat, defs, program.tasks, program.conditions);
    // A recheck rebuilds the Attack bands in their attacking state.
    program.groups = [];
  }
  const groups = activeGroups(defs, program.tasks);
  let raiderList: readonly Raider[] | null = null;
  const raiders = (): readonly Raider[] => (raiderList ??= seatRaiders(world, ctx, terrain, seat));
  updateSoldierList(world, ctx, seat, program.soldiers, NO_CLAIMS);
  // The computer player's military module crews and parks its own catapults.
  const catapults = autonomous ? NO_CATAPULT_ORDERS : catapultOrders(world, ctx, seat, program.soldiers);
  for (const entity of catapults.drafted) {
    if (world.tryGet(entity, AiOrder)?.source === 'map-ai') withdrawAiEntityOrder(world, ctx, entity);
  }
  const previous = new Map(program.soldiers.map((record) => [record.entity, record.task]));
  clearInvalidTasks(defs, groups, program.soldiers);
  const defaultPosition = autonomous ? null : program.defaultPosition;
  const commands = [...catapults.commands];
  if (recheck || turn % 2 === 0) {
    commands.push(
      ...assignSoldiers(world, ctx, defs, groups, program.soldiers, program.groups, defaultPosition),
    );
  }
  const claims = mapAiSoldierClaims(world, seat);
  const reassigned = new Set(
    program.soldiers
      .filter((record) => {
        if (record.task === null) return false;
        if (previous.get(record.entity) !== record.task) return true;
        // A disabled handler retains its task records while another controller may take its men.
        const source = world.tryGet(record.entity, AiOrder)?.source;
        return claims.has(record.entity) && source !== undefined && source !== 'map-ai';
      })
      .map((record) => record.entity),
  );
  releaseCampaignClaims(world, seat, claims);
  // The fallback guard must not start a walk that delays a tower's next posting decision.
  const wanted = towerPostOrders(
    world,
    ctx,
    terrain,
    ownedBuildings(world, seat),
    takeCensus(world, ctx, seat).ready.filter(
      (entity) => !claims.has(entity) && !catapults.drafted.has(entity),
    ),
    autonomous ? 'computer-player' : 'map-ai',
    raiders,
  ).claimed;
  for (let i = 0; i < program.soldiers.length; i++) {
    const record = program.soldiers[i];
    if (record === undefined) continue;
    if (!wanted.has(record.entity) || claims.has(record.entity)) continue;
    record.onDefault = false;
    record.task = null;
  }
  for (let i = 0; i < program.soldiers.length; i++) {
    const record = program.soldiers[i];
    if (record === undefined) continue;
    if (
      reassigned.has(record.entity) ||
      (previous.get(record.entity) !== null &&
        record.task === null &&
        world.tryGet(record.entity, AiOrder)?.source === 'map-ai')
    ) {
      withdrawAiEntityOrder(world, ctx, record.entity);
    }
  }
  commands.push(
    ...workOrders(
      world,
      ctx,
      terrain,
      seat,
      defs,
      groups,
      program.soldiers,
      program.groups,
      defaultPosition,
      reassigned,
    ),
  );
  commands.push(...townOrders(world, ctx, terrain, seat, script, program, raiders, turn));
  for (let i = 0; i < commands.length; i++) {
    const command = commands[i] as PlayerCommand;
    ctx.commands.enqueue(aiCommand(seat, command, 'map-ai'));
  }
};

const NO_CLAIMS: ReadonlySet<Entity> = new Set();
const NO_CATAPULT_ORDERS: CatapultDecision = { commands: [], drafted: NO_CLAIMS };

/** Handler turns between its rebuild, town and family passes. Original behavior. */
const REBUILD_EVERY_TURNS = 3;
const TOWN_EVERY_TURNS = 6;
const FAMILY_EVERY_TURNS = 12;

/**
 * The handler's own economy, for the strategic modules the map switched off: it raises lost buildings and
 * walls again, holds its stores, staffs and houses the town, and marries and breeds its people. Every pass
 * runs only while the strategic module owning that concern is off, so the two never order the same men.
 */
function townOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  seat: number,
  script: MapAiSeat | undefined,
  program: { readonly houses: readonly MapAiHouseRecord[]; readonly walls: readonly MapAiWallRecord[] },
  raiders: () => readonly Raider[],
  turn: number,
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  const staff = isScriptedEconomySeat(world, seat);
  const house = !computerModuleRuns(world, seat, 'homeExpansion');
  const build = !computerModuleRuns(world, seat, 'houseBuild');
  if (turn % REBUILD_EVERY_TURNS === 0 && build) {
    commands.push(...rebuildOrders(world, ctx, terrain, seat, program.houses, raiders()));
  }
  if (turn % TOWN_EVERY_TURNS === 0 && build) {
    commands.push(...wallRebuildOrders(world, ctx, terrain, seat, program.walls, raiders()));
  }
  if (turn % TOWN_EVERY_TURNS === 0 && (staff || house)) {
    if (staff) holdTownGoods(world, ctx, seat);
    commands.push(...townStaffingOrders(world, ctx, terrain, seat, raiders(), { staff, house }));
  }
  if (turn % FAMILY_EVERY_TURNS === 0 && house) commands.push(...familyOrders(world, ctx, seat, script));
  return commands;
}

/** The map's border band in map points, where the handler refuses a default position: the outermost
 *  two macro cells (the original's one-point parity nudge is left out). The original refuses a Defend, Attack or CreateCreatures point there too, which this build
 *  leaves out: no authored task of the corpus sits in the band. */
const BORDER_POINTS = 4;

function isBorderPoint(terrain: TerrainGraph, hx: number, hy: number): boolean {
  return (
    hx < BORDER_POINTS ||
    hy < BORDER_POINTS ||
    hx >= terrain.width - BORDER_POINTS ||
    hy >= terrain.height - BORDER_POINTS
  );
}

/** The range the handler gives a default position of its own making. */
const CENTRE_DEFAULT_RANGE = 15;
/** The Defend task a seat that authored none gets at its centre. */
const CENTRE_DEFEND_PRIORITY = 10;
const CENTRE_DEFEND_RANGE = 40;

/**
 * The seat's first turn: the authored default position, or one at the seat's centre when the map
 * authored none or put it in the border band, and a Defend of the centre when the script authored no
 * task at all, both only when the centre is not on the map's border. The external flags a script
 * declares raised start raised. Approximation: the original also refuses an authored position on
 * water (continent type 0), which this build does not judge.
 */
function startProgram(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  seat: number,
  script: MapAiSeat | undefined,
): Entity {
  const centre = seatCentre(world, ctx, seat);
  const usable = centre !== null && !isBorderPoint(terrain, centre.hx, centre.hy);
  const authored = script?.defaultPosition;
  const defaultPosition: MapAiDefaultPosition | null =
    authored !== undefined && !isBorderPoint(terrain, authored.x, authored.y)
      ? { hx: authored.x, hy: authored.y, range: authored.range }
      : usable
        ? { ...centre, range: CENTRE_DEFAULT_RANGE }
        : null;
  const defaultDefend = (script?.tasks.length ?? 0) === 0 && usable ? centre : null;
  for (const def of script?.conditions ?? []) {
    if (def.kind === 'onExternal' && def.raised) setAiExternalFlag(world, seat, def.slot, true);
  }
  const e = world.create();
  world.add(e, MapAiState, {
    player: seat,
    defaultPosition,
    defaultDefend,
    conditions: [],
    tasks: [],
    soldiers: [],
    groups: [],
    houses: rebuildList(world, ctx, seat),
    walls: wallList(world, ctx, terrain, seat, centre),
  });
  return e;
}

/** The script's tasks, plus the handler's own Defend of the centre after them. */
function taskDefs(
  script: MapAiSeat | undefined,
  defaultDefend: { hx: number; hy: number } | null,
): MapAiTask[] {
  const defs: MapAiTask[] = [...(script?.tasks ?? [])];
  if (defaultDefend !== null) {
    defs.push({
      kind: 'defend',
      priority: CENTRE_DEFEND_PRIORITY,
      condition: CONDITION_ALWAYS,
      x: defaultDefend.hx,
      y: defaultDefend.hy,
      range: CENTRE_DEFEND_RANGE,
      min: 0,
      max: 0,
    });
  }
  return defs;
}

/**
 * Where the seat lives: its first storage building (the headquarters or a stock, in entity order),
 * else the mean of everything it owns; null for a seat that owns nothing. Approximation: the original
 * walks from that mean to the nearest ground of the same continent, which this build leaves to the
 * walk orders' own clamping.
 */
function seatCentre(world: World, ctx: SystemContext, seat: number): { hx: number; hy: number } | null {
  const index = contentIndex(ctx.content);
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const e of ownedBuildings(world, seat)) {
    const at = world.tryGet(e, Position);
    if (at === undefined) continue;
    const node = nodeOfPosition(at.x, at.y);
    if (index.buildings.get(world.get(e, Building).buildingType)?.kind === 'storage') return node;
    sumX += node.hx;
    sumY += node.hy;
    count++;
  }
  for (const e of ownedSettlers(world, seat)) {
    const at = world.tryGet(e, Position);
    if (at === undefined) continue;
    const node = nodeOfPosition(at.x, at.y);
    sumX += node.hx;
    sumY += node.hy;
    count++;
  }
  if (count === 0) return null;
  return { hx: Math.trunc(sumX / count), hy: Math.trunc(sumY / count) };
}
