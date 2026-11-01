import {
  ClaimAnimalOrder,
  CurrentAtomic,
  ErectSignpostOrder,
  PlayerOrder,
  Settler,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { World } from '../../../ecs/world.js';
import { ownedSettlers } from '../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../context.js';
import { isScoutJob } from '../../readviews/index.js';
import type { BuildOrder } from '../build-order/entries.js';
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
  if (scout === undefined) return [];
  // CurrentAtomic has to be part of the busy test: both order markers are shed the moment a need drive
  // starts an atomic, so an eating scout would otherwise look order-free and be re-ordered every beat.
  if (world.has(scout, CurrentAtomic)) return [];
  if (
    world.has(scout, ErectSignpostOrder) ||
    world.has(scout, PlayerOrder) ||
    world.has(scout, ClaimAnimalOrder)
  )
    return []; // busy
  const scouts = scoutingOpen(world, ctx, player);
  const leads = scouts && scoutingLeads(ctx.tick);
  const zone = leads ? nextStaleZoneTarget(world, ctx, player, order) : null;
  if (zone !== null) return [{ kind: 'moveUnit', entity: scout, x: zone.hx, y: zone.hy }];
  const post = nextSignpostTarget(world, ctx, player, order);
  if (post !== null) return [{ kind: 'placeSignpost', entity: scout, x: post.hx, y: post.hy }];
  const herd = nextLivestockCatch(world, ctx, player);
  if (herd?.kind === 'claim') return [{ kind: 'claimAnimal', entity: scout, animal: herd.animal }];
  if (herd?.kind === 'look') return [{ kind: 'moveUnit', entity: scout, x: herd.node.hx, y: herd.node.hy }];
  const late = scouts && !leads ? nextStaleZoneTarget(world, ctx, player, order) : null;
  return late === null ? [] : [{ kind: 'moveUnit', entity: scout, x: late.hx, y: late.hy }];
}

/** The scout module over the seat's build order, whose collector goods name the deposits the lattice
 *  reaches out to. */
export function scoutModule(order: BuildOrder): ComputerModule {
  return {
    id: 'guideBuild',
    run: (world, ctx, player) => runScout(world, ctx, player, order),
  };
}
