import {
  CurrentAtomic,
  ErectSignpostOrder,
  JobAssignment,
  PlayerOrder,
  UnderConstruction,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { isMarried } from '../../family/eligibility.js';
import { scoutJobType } from '../../readviews/index.js';
import { seatBaseOf } from '../base.js';
import { type BuildOrderEntry, entryStatuses } from '../build-order/index.js';
import type { AiPlayerModule } from '../index.js';
import { nextLivestockCatch, nextSignpostTarget } from '../scout/index.js';
import { ownedBuildings, ownedSettlers } from '../shared.js';
import {
  allocateCollectors,
  allocateGenericCollectors,
  topUpCollectors,
  wantedCollectorGoods,
} from './collectors/index.js';
import { tuneCraftSelections } from './craft.js';
import type { TakenFlagNodes } from './flag-spots.js';
import { trainGarrison } from './garrison.js';
import { allocateOpeningHunter } from './hunter.js';
import { builderJobOf, classifyWorkforce, isAllocatableMan, SpareForce } from './pool.js';
import { reserveBuilders, staffBuildings } from './staffing.js';
import { buildStaffingTally } from './tally.js';

export { COLLECTOR_TARGET_BY_GOOD_ID, DEFAULT_COLLECTOR_TARGET } from './collectors/index.js';
export { CRAFT_RESTRICTIONS_BY_BUILDING_ID } from './craft.js';
export { FLAG_MAX_DISTANCE_NODES, FLAG_MIN_DISTANCE_NODES } from './flag-spots.js';
export { OPENING_HUNT_UNTIL_BUILDING_ID } from './hunter.js';
export { builderJobOf } from './pool.js';
export { BUILDER_CAP, STAFFING_BY_BUILDING_ID } from './staffing.js';

/**
 * The CollectResources module - the seat's one workforce allocator: no other module ever claims a
 * settler. The returned array's order is the allocation priority, essentials first and garrison sizing
 * last, and every target is recomputed from live state, so a transient conflict self-heals on the next
 * decision.
 */
function runWorkforce(
  world: World,
  ctx: SystemContext,
  player: number,
  order: readonly BuildOrderEntry[],
): readonly PlayerCommand[] {
  const builderJob = builderJobOf(ctx);
  const base = seatBaseOf(world, ctx, player);
  if (base === null) return rebuildCrew(world, ctx, player, builderJob);
  const statuses = entryStatuses(world, ctx, player, order);
  const wanted = wantedCollectorGoods(ctx, order, statuses);
  const { pool, collectorsByGood, genericCollectors, scouts } = classifyWorkforce(world, ctx, player, wanted);
  const force = new SpareForce(pool);
  const tally = buildStaffingTally(world);
  const taken: TakenFlagNodes = new Set();
  return [
    ...allocateCollectors(world, ctx, base, wanted, collectorsByGood, force, taken, builderJob),
    ...allocateOpeningHunter(world, ctx, player, base, force, builderJob),
    ...allocateScout(world, ctx, player, scouts, force, builderJob),
    ...staffBuildings(world, ctx, player, force, tally, 'min'),
    ...reserveBuilders(world, force, builderJob), // construction never starves
    ...staffBuildings(world, ctx, player, force, tally, 'target'),
    ...topUpCollectors(world, ctx, base, wanted, collectorsByGood, force, taken),
    ...staffBuildings(world, ctx, player, force, tally, 'surplus'),
    ...allocateGenericCollectors(world, ctx, base, genericCollectors, force, taken, builderJob),
    ...trainGarrison(world, ctx, player, force),
    ...tuneCraftSelections(world, ctx, player),
  ];
}

/**
 * What a baseless seat runs instead of the ladder: the builder reserve, then minimum staffing. The
 * based ladder's order is inverted here because this allocator is the only thing that turns a man into
 * a builder, so covering a vacancy first could leave a one-man seat with nobody to raise the site that
 * gives it a base back.
 */
function rebuildCrew(
  world: World,
  ctx: SystemContext,
  player: number,
  builderJob: number | null,
): readonly PlayerCommand[] {
  if (!ownedBuildings(world, player).some((e) => world.has(e, UnderConstruction))) return [];
  const force = new SpareForce(rebuildHands(world, ctx, player));
  return [
    ...reserveBuilders(world, force, builderJob),
    ...staffBuildings(world, ctx, player, force, buildStaffingTally(world), 'min'),
  ];
}

/**
 * Every man a baseless seat may put on that site, spare first: beyond the pool it takes scouts, generic
 * gatherers, and men standing at a post, whose job binding and work flag `setJob` drops. Without those
 * groups a seat whose few survivors were all classified or employed mints no builder and never regains
 * a base.
 */
function rebuildHands(world: World, ctx: SystemContext, player: number): Entity[] {
  const { pool, genericCollectors, scouts } = classifyWorkforce(world, ctx, player, []);
  const posted = ownedSettlers(world, player).filter(
    (e) => world.has(e, JobAssignment) && !world.has(e, CurrentAtomic) && isAllocatableMan(world, ctx, e),
  );
  return [...pool, ...scouts, ...genericCollectors, ...posted];
}

/** The scout hire and retire: one scout exists while either duty has work (`scout/index.ts`), an idle
 *  one turns back into a builder, and one mid-action is left alone because `setJob` cancels the running
 *  atomic. Only an unmarried man is hired (authored: a scout is away on a mission and his wife would
 *  wait forever). The hire ignores the seat's `guideBuild` toggle, which gates only the module that
 *  orders him, so a seat with GuideBuild off still pays for a scout. */
function allocateScout(
  world: World,
  ctx: SystemContext,
  player: number,
  scouts: readonly Entity[],
  force: SpareForce,
  builderJob: number | null,
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  const scoutJob = scoutJobType(ctx.content);
  // The round-up probes first even though it ranks second: a satisfied lattice has to scan every ring
  // to answer null, so the cheaper herd scan short-circuits it.
  const hasScoutWork =
    nextLivestockCatch(world, ctx, player) !== null || nextSignpostTarget(world, ctx, player) !== null;
  const keepScoutAs = scoutJob !== null && hasScoutWork ? scoutJob : null;
  if (keepScoutAs !== null && scouts.length === 0) {
    const spare = force.take((e) => !isMarried(world, e));
    if (spare !== null) commands.push({ kind: 'setJob', entity: spare, jobType: keepScoutAs });
  }
  for (const [i, scout] of scouts.entries()) {
    if (keepScoutAs !== null && i === 0) continue; // the working scout - keep
    if (world.has(scout, CurrentAtomic)) continue;
    if (world.has(scout, ErectSignpostOrder) || world.has(scout, PlayerOrder)) continue;
    if (builderJob !== null) commands.push({ kind: 'setJob', entity: scout, jobType: builderJob });
  }
  return commands;
}

export function workforceModule(order: readonly BuildOrderEntry[]): AiPlayerModule {
  return {
    id: 'collectResources',
    run: (world, ctx, player) => runWorkforce(world, ctx, player, order),
  };
}
