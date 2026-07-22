import { CurrentAtomic, ErectSignpostOrder, PlayerOrder } from '../../../components/index.js';
import type { Command } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { SCOUT_JOB } from '../../readviews/stances.js';
import type { BuildOrderEntry } from '../build-order/index.js';
import type { AiPlayerModule } from '../index.js';
import { headquartersOf } from '../shared.js';
import { nextSignpostTarget } from '../signpost-coverage.js';
import { allocateCollectors, wantedCollectorGoods } from './collectors.js';
import { builderJobOf, classifyWorkforce, SpareForce } from './pool.js';
import { resetPoolToBuilders, staffWorkplaces } from './staffing.js';

export {
  COLLECTED_GOOD_IDS,
  FLAG_MAX_DISTANCE_NODES,
  FLAG_MIN_DISTANCE_NODES,
  FLAG_RELOCATE_EVERY_DECISIONS,
} from './collectors.js';
export { builderJobOf } from './pool.js';
export {
  CARRIER_STAFFED_BUILDING_IDS,
  CARRIERS_PER_STAFFED_BUILDING,
  OPERATORS_PER_TRADE_BY_BUILDING_ID,
  WORKERS_PER_TRADE,
} from './staffing.js';

/**
 * The CollectResources module — the seat's one workforce allocator (user plan, 2026-07-17). Every adult
 * non-fighter man defaults to the builder trade (the total reset — the map may hand the seat settlers of
 * any profession), and the wanted roles are drawn back out of that pool in priority order: one
 * flag-bound gatherer per collector good, one scout while signpost work remains, then one worker per
 * operator trade of each built workplace. Allocation is centralized here so two modules never claim the
 * same settler within one decision; a transient conflict with the live world self-heals on the next
 * decision because every target is recomputed from state, never remembered.
 */
function runWorkforce(
  world: World,
  ctx: SystemContext,
  player: number,
  order: readonly BuildOrderEntry[],
): readonly Command[] {
  const hq = headquartersOf(world, ctx, player);
  if (hq === null) return [];
  const builderJob = builderJobOf(ctx);
  const wanted = wantedCollectorGoods(world, ctx, player, order);
  const { pool, collectorByGood, scouts } = classifyWorkforce(world, ctx, player, wanted);
  const force = new SpareForce(pool);
  // Phases run in this fixed order — collectors first (they claim beside their resource), then the
  // scout, workplace staffing, and finally the reset of whoever is left. Each phase claims from `force`
  // as it goes, so the reset only ever sees genuinely spare men.
  return [
    ...allocateCollectors(world, ctx, hq, wanted, collectorByGood, force, builderJob),
    ...allocateScout(world, ctx, player, scouts, force, builderJob),
    ...staffWorkplaces(world, ctx, hq, player, force),
    ...resetPoolToBuilders(world, force, builderJob),
  ];
}

/** Phase 2: the scout exists exactly while signpost work remains — an idle scout turns back into a
 *  builder; the lattice calls one up again when a post is missing. A scout mid-action is left alone:
 *  `setJob` cancels the running atomic, so retiring one mid-meal would throw the meal away (see
 *  signpost-coverage.ts). */
function allocateScout(
  world: World,
  ctx: SystemContext,
  player: number,
  scouts: readonly Entity[],
  force: SpareForce,
  builderJob: number | null,
): Command[] {
  const commands: Command[] = [];
  const scoutWanted =
    contentIndex(ctx.content).commandJobs.get(SCOUT_JOB) !== undefined &&
    nextSignpostTarget(world, ctx, player) !== null;
  if (scoutWanted && scouts.length === 0) {
    const spare = force.take();
    if (spare !== null) commands.push({ kind: 'setJob', entity: spare, jobType: SCOUT_JOB });
  }
  for (const [i, scout] of scouts.entries()) {
    if (scoutWanted && i === 0) continue; // the working scout — keep
    if (world.has(scout, CurrentAtomic)) continue;
    if (world.has(scout, ErectSignpostOrder) || world.has(scout, PlayerOrder)) continue;
    if (builderJob !== null) commands.push({ kind: 'setJob', entity: scout, jobType: builderJob });
  }
  return commands;
}

/** A module allocating against `order`'s collector gating — parameterized like `buildOrderModule`,
 *  so tests drive it with fixture orders. */
export function workforceModule(order: readonly BuildOrderEntry[]): AiPlayerModule {
  return {
    id: 'collectResources',
    run: (world, ctx, player) => runWorkforce(world, ctx, player, order),
  };
}
