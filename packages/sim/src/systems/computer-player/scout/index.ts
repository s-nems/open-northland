import {
  ClaimAnimalOrder,
  CurrentAtomic,
  ErectSignpostOrder,
  Female,
  MealBreak,
  mapBriefOf,
  OrderQueue,
  PlayerOrder,
  Settler,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import { ownedSettlers } from '../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../context.js';
import { isAdultSettler } from '../../family/eligibility.js';
import { isHeroJob, isScoutJob } from '../../readviews/index.js';
import { anyNeedPressing } from '../../settlers/drives/needs.js';
import type { BuildOrder } from '../build-order/entries.js';
import { minutesToTicks } from '../game-phase.js';
import type { ComputerModule } from '../index.js';
import { militaryDeadlineTick } from '../military/deadline.js';
import { nextLivestockCatch } from './livestock-catch.js';
import { nextSignpostTarget } from './signpost-coverage.js';
import { nextStaleZoneTarget } from './stale-zones.js';

export { type LivestockCatch, nextLivestockCatch, SCOUT_CATCH_RADIUS_NODES } from './livestock-catch.js';
export { type LostZones, SCOUT_LOSS_MEMORY_TICKS, scoutLostZones } from './lost-zones.js';
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
  SCOUT_TOWER_CLEARANCE_NODES,
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
 *  {@link SMALL_START_SCOUT_FROM_TICKS} while fewer than {@link SMALL_START_MEN} of its men stood at the
 *  map brief's scan, an entity below the brief's ceiling having stood then. */
export function scoutHeldForBuilders(world: World, ctx: SystemContext, player: number): boolean {
  if (ctx.tick >= SMALL_START_SCOUT_FROM_TICKS) return false;
  const brief = mapBriefOf(world);
  if (brief === null) return false;
  let men = 0;
  for (const e of ownedSettlers(world, player)) {
    if (e >= brief.entityCeiling || world.has(e, Female) || !isAdultSettler(world, e)) continue;
    if (isHeroJob(ctx.content, world.get(e, Settler).jobType)) continue;
    if (++men >= SMALL_START_MEN) return false;
  }
  return true;
}

/** Whether `player`'s scout scouts at all at `ctx.tick`: from {@link SCOUTING_DEADLINE_LEAD_TICKS} before
 *  its {@link militaryDeadlineTick}. Signposts and the round-up run from the start regardless. */
export function scoutingOpen(world: World, ctx: SystemContext, player: number): boolean {
  return ctx.tick >= militaryDeadlineTick(world, ctx, player) - SCOUTING_DEADLINE_LEAD_TICKS;
}

/** Whether scouting leads the scout's duties at `tick`: every other round after the opening. A trip only
 *  starts on a decision, so a round decides which duty the next free scout takes up, not how long he
 *  keeps at it. */
export function scoutingLeads(tick: number): boolean {
  return tick >= SCOUT_OPENING_TICKS && Math.floor(tick / SCOUTING_ROUND_TICKS) % 2 === 1;
}

/**
 * The GuideBuild module: the seat's one scout and the only issuer of its orders, so its duties can never
 * order the same man in one decision. Signposts outrank the round-up (authored): a lattice target is
 * static, while an animal that wanders off is picked up again next decision. Scouting stale zones comes
 * last in the opening, where the signposts gate where the gatherers may work, and first in every
 * {@link scoutingLeads} round after it, so the network keeps growing between trips. Before
 * {@link scoutingOpen} and with the fog off (nothing is stale) the order is the two duties alone.
 */
function runScout(
  world: World,
  ctx: SystemContext,
  player: number,
  order: BuildOrder,
): readonly PlayerCommand[] {
  const scout = ownedSettlers(world, player).find((e) =>
    isScoutJob(ctx.content, world.get(e, Settler).jobType),
  );
  if (scout === undefined || scoutHeldForBuilders(world, ctx, player)) return [];
  if (scoutBusy(world, ctx, scout)) return [];
  const scouts = scoutingOpen(world, ctx, player);
  const leads = scouts && scoutingLeads(ctx.tick);
  const zone = leads ? nextStaleZoneTarget(world, ctx, player, order) : null;
  if (zone !== null) return [{ kind: 'moveUnit', entity: scout, x: zone.hx, y: zone.hy }];
  const at = anchorNodeOf(world, scout);
  const post = nextSignpostTarget(world, ctx, player, order, at);
  if (post !== null) return [{ kind: 'placeSignpost', entity: scout, x: post.hx, y: post.hy }];
  const herd = nextLivestockCatch(world, ctx, player, at);
  if (herd?.kind === 'claim') return [{ kind: 'claimAnimal', entity: scout, animal: herd.animal }];
  if (herd?.kind === 'look') return [{ kind: 'moveUnit', entity: scout, x: herd.node.hx, y: herd.node.hy }];
  const late = scouts && !leads ? nextStaleZoneTarget(world, ctx, player, order) : null;
  return late === null ? [] : [{ kind: 'moveUnit', entity: scout, x: late.hx, y: late.hy }];
}

/**
 * Whether `scout` is busy and takes no order: on an order, mid-action, or answering a need. CurrentAtomic
 * counts because the order markers are shed the moment a need drive starts an atomic. A hungry or tired
 * scout, on a meal break or with orders queued behind one, is left to the needs drive: a fresh order
 * would end his meal break (`orders/meal-break.ts`), and on battle_for_the_four_hills_multiplayer the
 * scout re-ordered every decision starved.
 */
function scoutBusy(world: World, ctx: SystemContext, scout: Entity): boolean {
  return (
    world.has(scout, CurrentAtomic) ||
    world.has(scout, ErectSignpostOrder) ||
    world.has(scout, PlayerOrder) ||
    world.has(scout, ClaimAnimalOrder) ||
    world.has(scout, MealBreak) ||
    (world.tryGet(scout, OrderQueue)?.orders.length ?? 0) > 0 ||
    anyNeedPressing(world, ctx, scout)
  );
}

/** The scout module over the seat's build order, whose collector goods name the deposits the lattice
 *  reaches out to. */
export function scoutModule(order: BuildOrder): ComputerModule {
  return {
    id: 'guideBuild',
    run: (world, ctx, player) => runScout(world, ctx, player, order),
  };
}
