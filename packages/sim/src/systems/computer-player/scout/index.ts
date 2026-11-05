import {
  ClaimAnimalOrder,
  CurrentAtomic,
  ErectSignpostOrder,
  Female,
  MealBreak,
  MoveGoal,
  mapBriefOf,
  OpenChestOrder,
  OrderQueue,
  PlayerOrder,
  Settler,
  zoneOfNode,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import { type HalfCellNode, hexDistanceBetween } from '../../../nav/halfcell.js';
import { homeSettlers } from '../../ai-shared/home-roster.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../context.js';
import { isAdultSettler } from '../../family/eligibility.js';
import { interactionNode } from '../../footprint/index.js';
import { isHeroJob, isScoutJob } from '../../readviews/index.js';
import { anyNeedPressing } from '../../settlers/drives/needs.js';
import { seatBaseOf } from '../base.js';
import type { BuildOrder } from '../build-order/order/entries.js';
import { minutesToTicks } from '../game-phase.js';
import type { ComputerModule } from '../index.js';
import { recordScoutTurnBack } from '../knowledge/intel/index.js';
import { militaryDeadlineTick } from '../military/deadline.js';
import { druidChestOrder, nextScoutChest } from './chests.js';
import { enemyFighterNear, scoutDanger, seatHasSoldier } from './danger.js';
import { nextLivestockCatch } from './livestock-catch.js';
import { nextSignpostTarget } from './signpost-coverage.js';
import { nextStaleZoneTarget } from './stale-zones.js';

export { druidChestOrder, nextScoutChest } from './chests.js';
export {
  enemyFighterNear,
  SCOUT_FIGHTER_CLEARANCE_NODES,
  SCOUT_FIRE_CLEARANCE_NODES,
  type ScoutDanger,
  scoutDanger,
  seatHasSoldier,
} from './danger.js';
export { type LivestockCatch, nextLivestockCatch, SCOUT_CATCH_RADIUS_NODES } from './livestock-catch.js';
export {
  type LostZones,
  SCOUT_LOSS_MEMORY_TICKS,
  SCOUT_TURN_BACK_MEMORY_TICKS,
  scoutLostZones,
  scoutTurnedBackZones,
} from './lost-zones.js';
export {
  nextSignpostTarget,
  SIGNPOST_LATTICE_SPACING_NODES,
  SIGNPOST_TARGET_TOLERANCE_NODES,
  signpostLatticeOffset,
} from './signpost-coverage.js';
export {
  nextStaleZoneTarget,
  SCOUT_IMPORTANCE,
  SCOUT_REVISIT_TICKS,
  SCOUT_STALENESS_CAP_TICKS,
} from './stale-zones.js';

/** How long the opening lasts for the scout (authored): six game minutes, while the settlement's first
 *  lattice rings and corridors go up and its gatherers wait on them. */
export const SCOUT_OPENING_TICKS = 6 * 60 * TICKS_PER_SECOND;
/** After the opening the scout's duties take turns in rounds of this length (authored, untuned): two game
 *  minutes. */
export const SCOUTING_ROUND_TICKS = 2 * 60 * TICKS_PER_SECOND;
/** How long before the seat's military deadline its scout starts scouting (owner ruling: scout once the
 *  peace ends, a trip before it is wasted; authored lead): five game minutes, about one walk out to a near
 *  enemy start, so the first look lands as the deadline comes. */
export const SCOUTING_DEADLINE_LEAD_TICKS = 5 * 60 * TICKS_PER_SECOND;

/** Owner ruling: on a map of few start men the scout starts at game minute 15; before it the man is
 *  worth more as a builder. */
export const SMALL_START_SCOUT_FROM_TICKS = minutesToTicks(15);

/** Owner ruling: a seat starts small under this many adult men, heroes not counted (soldiers are, since
 *  the seat turns its start soldiers into civilians). battle_for_the_four_hills_multiplayer seats start
 *  with 7, ciezka_wspolpraca's with 9, both specjalna_forteca variants' with 10, the other measured maps'
 *  with 11-13. */
export const SMALL_START_MEN = 10;

/** Whether `player`'s seat holds off its scout at `ctx.tick` (owner ruling): before
 *  {@link SMALL_START_SCOUT_FROM_TICKS} while fewer than {@link SMALL_START_MEN} of the men who stood at the
 *  map brief's scan (an entity below the brief's ceiling) still live, so start men lost count too. */
export function scoutHeldForBuilders(world: World, ctx: SystemContext, player: number): boolean {
  if (ctx.tick >= SMALL_START_SCOUT_FROM_TICKS) return false;
  const brief = mapBriefOf(world);
  if (brief === null) return false;
  let men = 0;
  for (const e of homeSettlers(world, ctx, player)) {
    if (e >= brief.entityCeiling || world.has(e, Female) || !isAdultSettler(world, e)) continue;
    if (isHeroJob(ctx.content, world.get(e, Settler).jobType)) continue;
    if (++men >= SMALL_START_MEN) return false;
  }
  return true;
}

/** Whether `player`'s scout scouts at all at `ctx.tick`: from {@link SCOUTING_DEADLINE_LEAD_TICKS} before
 *  its {@link militaryDeadlineTick}, once the seat holds a soldier (owner ruling: a look at the enemy
 *  serves nothing before the seat can fight, peace over or not). Signposts and the round-up run from the
 *  start regardless. */
export function scoutingOpen(world: World, ctx: SystemContext, player: number): boolean {
  return (
    ctx.tick >= militaryDeadlineTick(world, ctx, player) - SCOUTING_DEADLINE_LEAD_TICKS &&
    seatHasSoldier(world, ctx, player)
  );
}

/** How far (hex nodes) from the base door a scout with nothing left to do still stands at home
 *  (authored): his 30-node sight, so one who looked at a far zone walks back instead of idling there. */
export const SCOUT_HOME_RADIUS_NODES = 30;

/** Whether scouting leads the scout's duties at `tick`: every other round after the opening. A trip only
 *  starts on a decision, so a round decides which duty the next free scout takes up, not how long he
 *  keeps at it. */
export function scoutingLeads(tick: number): boolean {
  return tick >= SCOUT_OPENING_TICKS && Math.floor(tick / SCOUTING_ROUND_TICKS) % 2 === 1;
}

/**
 * The GuideBuild module: the seat's one scout and the only issuer of its orders, so its duties can never
 * order the same man in one decision. Signposts come first, then the wooden chests, then the round-up
 * (authored): a lattice target and a chest stay put, while an animal that wanders off is picked up again
 * next decision. Scouting stale zones comes last in the opening, where the signposts gate where the
 * gatherers may work, and first in every {@link scoutingLeads} round after it, so the network keeps growing
 * between trips. Before {@link scoutingOpen} and with the fog off (nothing is stale) the order is the
 * three duties alone.
 */
function runScout(
  world: World,
  ctx: SystemContext,
  player: number,
  order: BuildOrder,
): readonly PlayerCommand[] {
  const scout = homeSettlers(world, ctx, player).find((e) =>
    isScoutJob(ctx.content, world.get(e, Settler).jobType),
  );
  if (scout === undefined || scoutHeldForBuilders(world, ctx, player)) return [];
  const at = anchorNodeOf(world, scout);
  const home = scoutHome(world, ctx, player);
  if (world.has(scout, PlayerOrder) && !world.has(scout, CurrentAtomic))
    return at === null || home === null ? [] : retreat(world, ctx, player, scout, at, home);
  if (scoutBusy(world, ctx, scout)) return [];
  const danger = scoutDanger(world, ctx, player);
  const scouts = scoutingOpen(world, ctx, player);
  const leads = scouts && scoutingLeads(ctx.tick);
  const zone = leads ? nextStaleZoneTarget(world, ctx, player, order, danger) : null;
  if (zone !== null) return [{ kind: 'moveUnit', entity: scout, x: zone.hx, y: zone.hy }];
  const post = nextSignpostTarget(world, ctx, player, order, at);
  if (post !== null) return [{ kind: 'placeSignpost', entity: scout, x: post.hx, y: post.hy }];
  const chest = nextScoutChest(world, ctx, player, at, danger);
  if (chest !== null) return [{ kind: 'openChest', entity: scout, chest }];
  const herd = nextLivestockCatch(world, ctx, player, at, danger);
  if (herd?.kind === 'claim') return [{ kind: 'claimAnimal', entity: scout, animal: herd.animal }];
  if (herd?.kind === 'look') return [{ kind: 'moveUnit', entity: scout, x: herd.node.hx, y: herd.node.hy }];
  const late = scouts && !leads ? nextStaleZoneTarget(world, ctx, player, order, danger) : null;
  if (late !== null) return [{ kind: 'moveUnit', entity: scout, x: late.hx, y: late.hy }];
  return at !== null && home !== null && !nearHome(at, home) ? [walkHome(scout, home)] : [];
}

/** Where the scout falls back to: the base door, else the base anchor; null with no base. */
function scoutHome(world: World, ctx: SystemContext, player: number): HalfCellNode | null {
  const base = seatBaseOf(world, ctx, player);
  if (base === null) return null;
  const door = interactionNode(world, ctx, base);
  return door === null ? anchorNodeOf(world, base) : { hx: door.x, hy: door.y };
}

function nearHome(at: HalfCellNode, home: HalfCellNode): boolean {
  return hexDistanceBetween(at.hx, at.hy, home.hx, home.hy) <= SCOUT_HOME_RADIUS_NODES;
}

function walkHome(scout: Entity, home: HalfCellNode): PlayerCommand {
  return { kind: 'moveUnit', entity: scout, x: home.hx, y: home.hy };
}

/**
 * The walk home for a scout on a move whose goal lies in the {@link scoutDanger} reach, who stands in
 * it, or who sees an enemy fighter near him (owner ruling: a scout looks from nearby and turns back, he
 * does not die): a tower first seen on the way, or an army, ends the trip, and the goal's zone is
 * recorded so the next look goes elsewhere ({@link nextStaleZoneTarget}). None while he already walks
 * home.
 */
function retreat(
  world: World,
  ctx: SystemContext,
  player: number,
  scout: Entity,
  at: HalfCellNode,
  home: HalfCellNode,
): PlayerCommand[] {
  const cell = world.tryGet(scout, MoveGoal)?.cell;
  const terrain = ctx.terrain;
  if (cell === undefined || terrain === undefined) return [];
  const coords = terrain.coordsOf(cell);
  const goal = { hx: coords.x, hy: coords.y };
  if (nearHome(goal, home)) return [];
  const danger = scoutDanger(world, ctx, player);
  const threatened =
    danger.covers(goal.hx, goal.hy) ||
    danger.covers(at.hx, at.hy) ||
    enemyFighterNear(world, ctx, player, at);
  if (!threatened) return [];
  const brief = mapBriefOf(world);
  if (brief !== null) recordScoutTurnBack(world, player, zoneOfNode(brief, goal.hx, goal.hy), ctx.tick);
  return [walkHome(scout, home)];
}

/**
 * Whether `scout` is busy and takes no order: on an order, mid-action, or answering a need. CurrentAtomic
 * counts because the order markers are shed the moment a need drive starts an atomic. A hungry or tired
 * scout, on a meal break or with orders queued behind one, is left to the needs drive: a fresh order
 * would end his meal break (`orders/meal-break.ts`), and on battle_for_the_four_hills_multiplayer the
 * scout re-ordered every decision starved.
 */
export function scoutBusy(world: World, ctx: SystemContext, scout: Entity): boolean {
  return (
    world.has(scout, CurrentAtomic) ||
    world.has(scout, ErectSignpostOrder) ||
    world.has(scout, PlayerOrder) ||
    world.has(scout, ClaimAnimalOrder) ||
    world.has(scout, OpenChestOrder) ||
    world.has(scout, MealBreak) ||
    (world.tryGet(scout, OrderQueue)?.orders.length ?? 0) > 0 ||
    anyNeedPressing(world, ctx, scout)
  );
}

/** The scout module over the seat's build order, whose collector goods name the deposits the lattice
 *  reaches out to. It also sends a druid to the magical chests, the one chest kind the scout cannot open. */
export function scoutModule(order: BuildOrder): ComputerModule {
  return {
    id: 'guideBuild',
    run: (world, ctx, player) => {
      const druid = druidChestOrder(world, ctx, player);
      const scout = runScout(world, ctx, player, order);
      return druid === null ? scout : [...scout, druid];
    },
  };
}
