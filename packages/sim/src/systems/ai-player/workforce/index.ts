import {
  CurrentAtomic,
  ErectSignpostOrder,
  JobAssignment,
  PlayerOrder,
  UnderConstruction,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { HalfCellNode } from '../../../nav/halfcell.js';
import type { SystemContext } from '../../context.js';
import { isMarried } from '../../family/eligibility.js';
import { scoutJobType } from '../../readviews/index.js';
import { atomicHoldsSettler } from '../../settlers/atomics/busy.js';
import { seatBaseOf } from '../base.js';
import { type BuildOrderEntry, entryStatuses } from '../build-order/index.js';
import type { AiPlayerModule } from '../index.js';
import { workableResourceTest } from '../live-resources.js';
import { anchorNodeOf } from '../node-geometry.js';
import { nextLivestockCatch, nextSignpostTarget } from '../scout/index.js';
import { ownedBuildings, ownedSettlers } from '../seat-roster.js';
import {
  allocateCollectors,
  allocateGenericCollectors,
  type CollectorGround,
  clearingCollectors,
  collectorAnchors,
  farGroundExtras,
  GENERIC_COLLECTOR_TARGET,
  topUpCollectors,
  wantedCollectorGoods,
} from './collectors/index.js';
import { tuneCraftSelections } from './craft.js';
import { allocateFishers, fishingPlan } from './fisher.js';
import type { TakenFlagNodes } from './flag-spots.js';
import { claimArmyFloor, trainGarrison } from './garrison.js';
import { allocateOpeningHunter } from './hunter.js';
import { builderJobOf, civilianCount, classifyWorkforce, isAllocatableMan, SpareForce } from './pool.js';
import {
  BUILDER_CAP,
  builderCap,
  releaseSurplusCarriers,
  releaseSurplusOperators,
  reserveBuilders,
  staffBuildings,
} from './staffing.js';
import type { SeatStaffing } from './staffing-plan.js';
import { SeatSupply } from './supply.js';
import { buildStaffingTally } from './tally.js';

export {
  CIVILIANS_PER_CLEARING_COLLECTOR,
  COLLECTOR_TARGET_BY_GOOD_ID,
  COLLECTOR_WORKSHOP_BY_GOOD_ID,
  DEFAULT_COLLECTOR_TARGET,
} from './collectors/index.js';
export { CRAFT_PLANS_BY_BUILDING_ID } from './craft.js';
export { FLAG_MAX_DISTANCE_NODES, FLAG_MIN_DISTANCE_NODES } from './flag-spots.js';
export { OPENING_HUNT_UNTIL_BUILDING_ID } from './hunter.js';
export { builderJobOf } from './pool.js';
export { BUILDER_CAP, LATE_GAME_BUILDER_CAP } from './staffing.js';
export {
  LATE_GAME_CIVILIANS,
  STAFFING_BY_BUILDING_ID,
  SUPPLY_CARRIER_GOODS_BY_BUILDING_ID,
} from './staffing-plan.js';
export { SeatSupply, type SupplyLines, supplyLines } from './supply.js';

/**
 * The CollectResources module - the seat's one workforce allocator: no other module ever claims a
 * settler. The returned array's order is the allocation priority, essentials first, then the army floor,
 * garrison sizing last, and every target is recomputed from live state, so a transient conflict
 * self-heals on the next decision.
 */
function runWorkforce(
  world: World,
  ctx: SystemContext,
  player: number,
  order: readonly BuildOrderEntry[],
): readonly PlayerCommand[] {
  const builderJob = builderJobOf(ctx);
  const base = seatBaseOf(world, ctx, player);
  if (base === null) return rebuildCrew(world, ctx, player, order, builderJob);
  const owned = ownedBuildings(world, player);
  const supply = SeatSupply.of(world, ctx, player, owned, order);
  const statuses = entryStatuses(world, ctx, player, order);
  const civilians = civilianCount(world, ctx, player);
  const wanted = wantedCollectorGoods(world, ctx, player, order, statuses, supply);
  const clearing = clearingCollectors(world, player, civilians);
  const baseNode = anchorNodeOf(world, base);
  const farGround = baseNode === null ? 0 : farGroundExtras(world, ctx, owned, baseNode);
  const genericTarget = GENERIC_COLLECTOR_TARGET + clearing + farGround;
  const { pool, collectorsByGood, genericCollectors, scouts } = classifyWorkforce(
    world,
    ctx,
    player,
    wanted,
    genericTarget,
  );
  const force = new SpareForce(pool);
  const tally = buildStaffingTally(world);
  const taken: TakenFlagNodes = new Set();
  const fishing = fishingPlan(world, ctx, player);
  const seat: SeatStaffing = { player, owned, civilians, supply };
  const ground = collectorGround(world, ctx, seat.owned, baseNode);
  const generic = (): PlayerCommand[] =>
    ground === null
      ? []
      : allocateGenericCollectors(
          world,
          ctx,
          base,
          ground.workable,
          genericCollectors,
          force,
          taken,
          builderJob,
          genericTarget,
        );
  const essentials = [
    ...(ground === null
      ? []
      : allocateCollectors(world, ctx, player, ground, wanted, collectorsByGood, force, taken, builderJob)),
    ...allocateOpeningHunter(world, ctx, player, base, force, builderJob),
    ...allocateFishers(world, ctx, fishing, force, builderJob, 'first'),
    ...allocateScout(world, ctx, player, scouts, force, builderJob),
    ...releaseSurplusCarriers(world, ctx, seat, tally, builderJob),
    ...releaseSurplusOperators(world, ctx, seat, tally, builderJob),
    ...staffBuildings(world, ctx, seat, force, tally, 'min'),
    ...reserveBuilders(world, force, builderJob, builderCap(civilians)), // construction never starves
  ];
  // The army floor outranks the clearing and every target and top-up post, so trades that could absorb
  // every man still leave an army.
  const armyFloor = claimArmyFloor(world, ctx, player, force);
  return [
    ...essentials,
    // A stalled placement blocks the whole build order, so clearing its ground outranks every top-up.
    ...(clearing > 0 ? generic() : []),
    ...staffBuildings(world, ctx, seat, force, tally, 'target'),
    ...(ground === null ? [] : topUpCollectors(world, ctx, ground, wanted, collectorsByGood, force, taken)),
    ...allocateFishers(world, ctx, fishing, force, builderJob, 'topUp'),
    ...staffBuildings(world, ctx, seat, force, tally, 'surplus'),
    ...(clearing > 0 ? [] : generic()),
    ...trainGarrison(world, ctx, player, force, armyFloor),
    ...tuneCraftSelections(world, ctx, player, supply),
  ];
}

/** The decision's {@link CollectorGround}, or null on a mapless sim or a base with no node. */
function collectorGround(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
  baseNode: HalfCellNode | null,
): CollectorGround | null {
  if (ctx.terrain === undefined || baseNode === null) return null;
  return {
    anchors: collectorAnchors(world, ctx, owned, baseNode),
    baseNode,
    workable: workableResourceTest(world, ctx, ctx.terrain),
  };
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
  order: readonly BuildOrderEntry[],
  builderJob: number | null,
): readonly PlayerCommand[] {
  const owned = ownedBuildings(world, player);
  if (!owned.some((e) => world.has(e, UnderConstruction))) return [];
  const force = new SpareForce(rebuildHands(world, ctx, player));
  const seat: SeatStaffing = {
    player,
    owned,
    civilians: civilianCount(world, ctx, player),
    supply: SeatSupply.of(world, ctx, player, owned, order),
  };
  return [
    ...reserveBuilders(world, force, builderJob, BUILDER_CAP),
    ...staffBuildings(world, ctx, seat, force, buildStaffingTally(world), 'min'),
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
    (e) => world.has(e, JobAssignment) && !atomicHoldsSettler(world, e) && isAllocatableMan(world, ctx, e),
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
