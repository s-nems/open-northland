import {
  assistantMovesFlags,
  Building,
  CurrentAtomic,
  ErectSignpostOrder,
  JobAssignment,
  PlayerOrder,
  Position,
  UnderConstruction,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { type HalfCellNode, nodeHxOfPosition, nodeHyOfPosition } from '../../../nav/halfcell.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { WORKFORCE_EVERY_DECISIONS } from '../../ai-shared/cadence.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import { ownedBuildings, ownedSettlers } from '../../ai-shared/seat-roster.js';
import {
  builderJobOf,
  civilianCount,
  classifyWorkforce,
  isAllocatableMan,
  SpareForce,
} from '../../ai-shared/workforce/pool.js';
import type { SystemContext } from '../../context.js';
import { isMarried } from '../../family/eligibility.js';
import { scoutJobType } from '../../readviews/index.js';
import { atomicHoldsSettler } from '../../settlers/atomics/busy.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { type NavigationLimit, networkLimitAt } from '../../signposts/index.js';
import { seatBaseOf } from '../base.js';
import { type BuildOrder, lineStatuses, seatBuildOrder, seatTuning } from '../build-order/index.js';
import { type ComputerProfile, computerProfileOf } from '../difficulty.js';
import type { ComputerModule } from '../index.js';
import { knownResourceTest, reachableResourceTest, workableResourceTest } from '../live-resources.js';
import { nextLivestockCatch, nextSignpostTarget, nextStaleZoneTarget, scoutingOpen } from '../scout/index.js';
import { seatApprentices } from '../technology/apprentices.js';
import { Promotions } from '../technology/promotion.js';
import { Schooling } from '../technology/schooling.js';
import {
  allocateCollectors,
  allocateGenericCollectors,
  type CollectorGround,
  clearingCollectors,
  collectorAnchors,
  farGroundExtras,
  GENERIC_COLLECTOR_TARGET,
  rowPosts,
  SHORTAGE_BUILDER_FLOOR,
  topUpCollectors,
  wantedCollectorGoods,
} from './collectors/index.js';
import { tuneCraftCounters } from './craft.js';
import { allocateFishers, fishingPlan } from './fisher.js';
import { flagGround, type TakenFlagNodes, unsealedResourceTest } from './flag-spots.js';
import { foodHunters } from './food.js';
import { calledGatherers, claimArmyFloor, garrisonArms, trainGarrison, upperReserve } from './garrison.js';
import { settlementGrantOrders } from './grants.js';
import { assignHaulingCarts } from './hauling-carts.js';
import { allocateHunters, huntingPlan } from './hunter.js';
import { allocateRoadCrew } from './road-crew.js';
import {
  builderCap,
  type GatedSlotSources,
  releaseSurplusCarriers,
  releaseSurplusOperators,
  reserveBuilders,
  STALLED_BUILDER_CAP,
  seatBuilderCount,
  siteBuilderFloor,
  staffBuildings,
} from './staffing.js';
import type { SeatStaffing } from './staffing-plan.js';
import { SeatSupply } from './supply.js';
import { buildStaffingTally } from './tally.js';

export { builderJobOf } from '../../ai-shared/workforce/pool.js';
export {
  CIVILIANS_PER_CLEARING_COLLECTOR,
  COLLECTOR_TARGET_BY_GOOD_ID,
  COLLECTOR_WORKSHOP_BY_GOOD_ID,
  DEFAULT_COLLECTOR_TARGET,
} from './collectors/index.js';
export {
  CRAFT_PLANS_BY_BUILDING_ID,
  CRAFT_PLANS_BY_JOINERY_ROLE,
  NATURAL_ARMS_CRAFT_PLANS,
} from './craft.js';
export { FLAG_MAX_DISTANCE_NODES, FLAG_MIN_DISTANCE_NODES } from './flag-spots.js';
export {
  BACKLOG_ROAD_CREW,
  LATE_BACKLOG_ROAD_CREW,
  ROAD_BACKLOG_RELEASE_SITES,
  ROAD_BACKLOG_SITES,
  ROAD_CREW,
  roadCrewTarget,
} from './road-crew.js';
export { BUILDERS_PER_OPEN_SITE, STALLED_BUILDER_CAP } from './staffing.js';
export { LATE_GAME_CIVILIANS, SUPPLY_CARRIER_GOODS_BY_BUILDING_ID } from './staffing-plan.js';
export { STAFFING_BY_BUILDING_ID } from './staffing-rows.js';
export { SeatSupply, type SupplyLine, type SupplyLines, supplyLines } from './supply.js';

/**
 * The CollectResources module - the seat's one workforce allocator: no other module ever claims a
 * settler. The returned array's order is the allocation priority: essentials first, then the clearing posts,
 * the standing buildings' target crews and the reached gatherer posts, then the army floor, the surplus
 * tier and the generic posts, garrison sizing last, and every target is recomputed from live state, so a transient conflict
 * self-heals on the next decision.
 */
function runWorkforce(
  world: World,
  ctx: SystemContext,
  player: number,
  fullOrder: BuildOrder,
): readonly PlayerCommand[] {
  const profile = computerProfileOf(world, player);
  const order = seatBuildOrder(world, player, ctx.tick, fullOrder, profile);
  const builderJob = builderJobOf(ctx);
  const base = seatBaseOf(world, ctx, player);
  if (base === null) return rebuildCrew(world, ctx, player, order, profile, builderJob);
  const owned = ownedBuildings(world, player);
  const supply = SeatSupply.of(world, ctx, player, owned, order);
  const statuses = lineStatuses(world, ctx, player, owned, order);
  const apprentices = seatApprentices(world, ctx, player, order, statuses);
  const civilians = civilianCount(world, ctx, player);
  const clearing = clearingCollectors(world, player, civilians);
  // The open sites' builders come before every gatherer post past a good's row: while the seat has fewer,
  // the extra posts and the far-ground posts go back to the sites, and no shortage post takes a builder.
  // While a placement is stalled the reserve shrinks to its floor, so the clearing posts get the men the
  // missing sites would have had.
  const builderLimit = clearing > 0 ? STALLED_BUILDER_CAP : builderCap(profile, civilians, ctx.tick);
  const builderFloor = siteBuilderFloor(world, ctx, owned, builderLimit);
  const shortOfBuilders = seatBuilderCount(world, player, builderJob) < builderFloor;
  const allWanted = wantedCollectorGoods(world, ctx, player, order, statuses, supply);
  const wanted = shortOfBuilders ? rowPosts(allWanted) : allWanted;
  const baseNode = anchorNodeOf(world, base);
  const farGround =
    baseNode === null || shortOfBuilders
      ? 0
      : farGroundExtras(world, ctx, owned, baseNode, seatTuning(world, player).clearGroundPct);
  const genericTarget = GENERIC_COLLECTOR_TARGET + clearing + farGround;
  const { pool, collectorsByGood, genericCollectors, fishers, scouts, roadsters } = classifyWorkforce(
    world,
    ctx,
    player,
    wanted,
    genericTarget,
  );
  // An apprentice stays on the work earning his discovery, so no post takes him off it.
  const force = new SpareForce(apprentices.size === 0 ? pool : pool.filter((e) => !apprentices.has(e)));
  const tally = buildStaffingTally(world, player, owned);
  const taken: TakenFlagNodes = new Set();
  const gated: GatedSlotSources = {
    promotions: new Promotions(world, ctx, player, apprentices),
    schooling: new Schooling(world, ctx, player, owned),
  };
  const seat: SeatStaffing = { player, owned, supply, profile, apprentices };
  const ground = collectorGround(world, ctx, player, seat.owned, baseNode);
  const fishing = fishingPlan(world, ctx, player, ground?.flags ?? null, fishers);
  const hunting = huntingPlan(
    world,
    ctx,
    player,
    base,
    (held) => foodHunters(world, ctx, player, owned, supply, tally, held, (fishing?.stands.length ?? 0) > 0),
    apprentices,
  );
  const generic = (): PlayerCommand[] =>
    ground === null
      ? []
      : allocateGenericCollectors(
          world,
          ctx,
          ground,
          genericCollectors,
          force,
          taken,
          builderJob,
          genericTarget,
        );
  const posted = [
    ...(ground === null
      ? []
      : allocateCollectors(
          world,
          ctx,
          player,
          ground,
          wanted,
          collectorsByGood,
          genericCollectors,
          force,
          taken,
          builderJob,
          apprentices,
          Math.max(SHORTAGE_BUILDER_FLOOR, builderFloor),
        )),
    ...allocateHunters(world, ctx, player, hunting, force, builderJob, tally, 'first'),
    ...allocateFishers(world, ctx, fishing, force, builderJob, taken, 'first'),
    ...allocateScout(world, ctx, player, order, scouts, force, builderJob),
    ...releaseSurplusCarriers(world, ctx, seat, tally, builderJob),
    ...releaseSurplusOperators(world, ctx, seat, tally, builderJob),
    ...staffBuildings(world, ctx, seat, force, tally, 'min', gated),
  ];
  // The road crew comes out of the builder reserve, ahead of it, so a seat with road sites always has
  // its roadster.
  const roadCrew = allocateRoadCrew(world, ctx, player, roadsters, force, builderJob);
  // Construction never starves. The road crew is part of the reserve. The army floor may reclaim the
  // reserve past its core (`garrison.ts`), so its fresh men's commands wait.
  const reserveCap = Math.max(0, builderLimit - roadCrew.crew);
  const reserve = reserveBuilders(world, force, builderJob, reserveCap, ctx);
  // The standing buildings' target crews and the gatherers the reached entries count come before the army
  // floor (authored): both are bounded by what stands, so a seat staffs every building it raised and
  // still leaves the rest to the army. The floor outranks the surplus tier and the generic posts, which
  // could absorb every man.
  const targets = [
    // A stalled placement blocks the whole build order, so clearing its ground outranks every top-up.
    ...(clearing > 0 ? generic() : []),
    ...staffBuildings(world, ctx, seat, force, tally, 'target', gated),
    ...(ground === null ? [] : topUpCollectors(world, ctx, ground, wanted, collectorsByGood, force, taken)),
  ];
  const arms = garrisonArms(world, ctx, player, profile);
  const armyFloor = claimArmyFloor(world, ctx, player, force, arms, profile, {
    men: upperReserve(reserve.reserved, reserveCap),
    builderJob,
    gatherers: calledGatherers(world, ctx, player, collectorsByGood, supply, apprentices),
  });
  const drafted = new Set(armyFloor.men);
  const undrafted = (c: PlayerCommand): boolean => !('entity' in c && drafted.has(c.entity));
  return [
    ...flagFollowSwitch(world, player),
    ...settlementGrantOrders(world, ctx, player),
    ...posted.filter(undrafted),
    ...roadCrew.commands,
    ...reserve.commands.filter(undrafted),
    ...targets,
    ...armyFloor.commands,
    ...allocateFishers(world, ctx, fishing, force, builderJob, taken, 'topUp'),
    ...allocateHunters(world, ctx, player, hunting, force, builderJob, tally, 'surplus'),
    ...staffBuildings(world, ctx, seat, force, tally, 'surplus', gated),
    ...(clearing > 0 ? [] : generic()),
    ...trainGarrison(world, ctx, player, force, armyFloor.men, arms, profile),
    ...tuneCraftCounters(world, ctx, player, supply, profile),
    ...assignHaulingCarts(world, ctx, player),
  ];
}

/** The command turning the seat's "gatherers move their flags" switch on, until it is: the seat's worked-out
 *  flags move by the same assistant feature a player switches on. */
function flagFollowSwitch(world: World, player: number): PlayerCommand[] {
  return assistantMovesFlags(world, player) ? [] : [{ kind: 'setAssistantMoveFlags', player, enabled: true }];
}

/** The decision's {@link CollectorGround}, or null on a mapless sim or a base with no node. A resource
 *  counts as workable only on the base's own walkable component, where the seat's men stand, with its
 *  work cell inside the seat's signpost reach, where its gatherer may walk, and not sealed in a pocket
 *  of buildings, resources or landscape that walk never enters. */
function collectorGround(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
  baseNode: HalfCellNode | null,
): CollectorGround | null {
  if (ctx.terrain === undefined || baseNode === null) return null;
  const terrain = ctx.terrain;
  const flags = flagGround(
    world,
    ctx,
    terrain,
    networkLimitAt(world, terrain, player, baseNode.hx, baseNode.hy),
    'aimed',
  );
  const reachable = reachableResourceTest(
    world,
    ctx,
    terrain,
    baseNode,
    workableResourceTest(world, ctx, terrain),
  );
  const unsealed = unsealedResourceTest(world, ctx, flags, baseNode);
  const { limit } = flags;
  const origin = terrain.nodeAtClamped(baseNode.hx, baseNode.hy);
  const maxWorkOffset = contentIndex(ctx.content).maxResourceWorkOffset;
  const verdicts = workableVerdictsOf(world);
  const epoch = verdicts.open();
  const judge =
    limit === null
      ? (e: Entity): boolean => reachable(e) && unsealed(e)
      : (e: Entity): boolean =>
          mayWorkInside(world, terrain, limit, e, maxWorkOffset) &&
          reachable(e) &&
          limit.allowsNode(interactionCell(world, ctx, terrain, e, origin)) &&
          unsealed(e);
  // Every test reads state the decision cannot change, so each resource is judged once per decision.
  const judged = (e: Entity): boolean => verdicts.judged(e, epoch, judge);
  const known = knownResourceTest(world, ctx, player);
  const workable = known === null ? judged : (e: Entity): boolean => known(e) && judged(e);
  return { anchors: collectorAnchors(world, ctx, owned, baseNode), baseNode, flags, workable, known };
}

/** False only when `limit` provably refuses `e`'s work cell: a resource's work cell lies at most
 *  `maxWorkOffset` Manhattan nodes from its anchor, so an anchor with nothing allowed that near has none
 *  inside. A building's door can lie farther out, and is judged by the full test. */
function mayWorkInside(
  world: World,
  terrain: TerrainGraph,
  limit: NavigationLimit,
  e: Entity,
  maxWorkOffset: number,
): boolean {
  if (limit.mayAllowNear === undefined || world.has(e, Building)) return true;
  const p = world.tryGet(e, Position);
  if (p === undefined) return true;
  const hx = nodeHxOfPosition(p.x, p.y);
  const hy = nodeHyOfPosition(p.x, p.y);
  return !terrain.inBounds(hx, hy) || limit.mayAllowNear(hx, hy, maxWorkOffset);
}

/** Verdicts per entity id, each valid only for the decision that stamped it: `stamps[e]` is that
 *  decision's epoch shifted left by one, plus the verdict. Derived read-state, never hashed. */
class DecisionVerdicts {
  private stamps = new Float64Array(0);
  private epochs = 0;

  /** A fresh epoch: no stamp of an earlier one matches it. */
  open(): number {
    return ++this.epochs;
  }

  judged(e: Entity, epoch: number, judge: (e: Entity) => boolean): boolean {
    if (e >= this.stamps.length) {
      const next = new Float64Array(Math.max(e + 1, this.stamps.length * 2));
      next.set(this.stamps);
      this.stamps = next;
    }
    const stamp = this.stamps[e] as number;
    const base = epoch * 2;
    if (stamp === base || stamp === base + 1) return stamp === base + 1;
    const verdict = judge(e);
    this.stamps[e] = base + (verdict ? 1 : 0);
    return verdict;
  }
}

/** Per world, so two simulations in one process never read each other's stamps. */
const workableVerdicts = new WeakMap<World, DecisionVerdicts>();

function workableVerdictsOf(world: World): DecisionVerdicts {
  let verdicts = workableVerdicts.get(world);
  if (verdicts === undefined) {
    verdicts = new DecisionVerdicts();
    workableVerdicts.set(world, verdicts);
  }
  return verdicts;
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
  order: BuildOrder,
  profile: ComputerProfile,
  builderJob: number | null,
): readonly PlayerCommand[] {
  const owned = ownedBuildings(world, player);
  if (!owned.some((e) => world.has(e, UnderConstruction))) return [];
  const force = new SpareForce(rebuildHands(world, ctx, player));
  const supply = SeatSupply.of(world, ctx, player, owned, order);
  const seat: SeatStaffing = { player, owned, supply, profile };
  return [
    ...reserveBuilders(world, force, builderJob, profile.builders.opening, ctx).commands,
    ...staffBuildings(world, ctx, seat, force, buildStaffingTally(world, player, owned), 'min', {
      promotions: new Promotions(world, ctx, player, new Set()),
      schooling: new Schooling(world, ctx, player, owned),
    }),
  ];
}

/**
 * Every man a baseless seat may put on that site, spare first: beyond the pool it takes scouts, generic
 * gatherers, flag fishers, and men standing at a post, whose job binding and work flag `setJob` drops.
 * Without those groups a seat whose few survivors were all classified or employed mints no builder and never regains
 * a base.
 */
function rebuildHands(world: World, ctx: SystemContext, player: number): Entity[] {
  const { pool, genericCollectors, fishers, scouts } = classifyWorkforce(world, ctx, player, []);
  const posted = ownedSettlers(world, player).filter(
    (e) => world.has(e, JobAssignment) && !atomicHoldsSettler(world, e) && isAllocatableMan(world, ctx, e),
  );
  return [...pool, ...scouts, ...genericCollectors, ...fishers, ...posted];
}

/** The scout hire and retire: one scout exists while any of his duties has work (`scout/index.ts`), an
 *  idle one turns back into a builder, and one mid-action is left alone because `setJob` cancels the running
 *  atomic. Only an unmarried man is hired (authored: a scout is away on a mission and his wife would
 *  wait forever). The hire ignores the seat's `guideBuild` toggle, which gates only the module that
 *  orders him, so a seat with GuideBuild off still pays for a scout. */
function allocateScout(
  world: World,
  ctx: SystemContext,
  player: number,
  order: BuildOrder,
  scouts: readonly Entity[],
  force: SpareForce,
  builderJob: number | null,
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  const scoutJob = scoutJobType(ctx.content);
  // Asked only when the answer decides a hire or an idle scout's keep: a busy scout keeps his job either
  // way, and a satisfied lattice has to scan every ring to answer null. The duties probe cheapest first,
  // whatever their rank, so the herd scan and the stale zones short-circuit the lattice.
  let scoutWork: boolean | undefined;
  const hasScoutWork = (): boolean => {
    scoutWork ??=
      nextLivestockCatch(world, ctx, player) !== null ||
      (scoutingOpen(world, ctx, player) && nextStaleZoneTarget(world, ctx, player, order) !== null) ||
      nextSignpostTarget(world, ctx, player, order) !== null;
    return scoutWork;
  };
  const unmarried = (e: Entity): boolean => !isMarried(world, e);
  if (scoutJob !== null && scouts.length === 0 && force.any(unmarried) && hasScoutWork()) {
    const spare = force.take(unmarried);
    if (spare !== null) commands.push({ kind: 'setJob', entity: spare, jobType: scoutJob });
  }
  for (const [i, scout] of scouts.entries()) {
    if (world.has(scout, CurrentAtomic)) continue;
    if (world.has(scout, ErectSignpostOrder) || world.has(scout, PlayerOrder)) continue;
    if (builderJob === null) continue;
    if (i === 0 && scoutJob !== null && hasScoutWork()) continue; // the working scout - keep
    commands.push({ kind: 'setJob', entity: scout, jobType: builderJob });
  }
  return commands;
}

export function workforceModule(order: BuildOrder): ComputerModule {
  return {
    id: 'collectResources',
    run: (world, ctx, player) => runWorkforce(world, ctx, player, order),
    everyDecisions: WORKFORCE_EVERY_DECISIONS,
  };
}
