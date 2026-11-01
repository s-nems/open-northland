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
import { isUnwed } from '../../family/eligibility.js';
import { scoutJobType } from '../../readviews/index.js';
import { atomicHoldsSettler } from '../../settlers/atomics/busy.js';
import { interactionCell } from '../../settlers/targets/index.js';
import { type NavigationLimit, networkLimitAt } from '../../signposts/index.js';
import { seatBaseOf } from '../base.js';
import { breadChainUnfinished, fishFeedsWomen, focusChainSite } from '../build-order/food-first.js';
import { openingHomesStand } from '../build-order/housing.js';
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
  COLLECTED_GOOD_IDS,
  type CollectorGround,
  clearingAim,
  clearingCollectors,
  collectorAnchors,
  farGroundExtras,
  GENERIC_COLLECTOR_TARGET,
  rowPosts,
  SHORTAGE_BUILDER_FLOOR,
  topUpCollectors,
  type WantedGood,
  wantedCollectorGoods,
} from './collectors/index.js';
import { tuneCraftCounters } from './craft.js';
import { demobilizeStartSoldiers } from './demobilize.js';
import { allocateFishers, fisherTarget, fishingPlan } from './fisher.js';
import { flagGround, type TakenFlagNodes, unsealedResourceTest } from './flag-spots.js';
import {
  FOCUS_BUILDERS,
  focusCrewOrders,
  focusShortGoods,
  focusShortPosts,
  focusYieldPosts,
} from './focus-crew.js';
import { foodHunters } from './food.js';
import {
  calledGatherers,
  claimArmyFloor,
  garrisonArms,
  trainGarrison,
  underAttack,
  upperReserve,
} from './garrison.js';
import { settlementGrantOrders } from './grants.js';
import { assignHaulingCarts } from './hauling-carts.js';
import { allocateHunters, huntingPlan } from './hunter.js';
import { allocateRoadCrew } from './road-crew.js';
import {
  builderCap,
  coreBuilderFloor,
  type GatedSlotSources,
  releaseSurplusCarriers,
  releaseSurplusOperators,
  reserveBuilders,
  seatBuilderCount,
  siteBuilderFloor,
  staffBuildings,
  stalledBuilderLimit,
} from './staffing.js';
import type { SeatStaffing } from './staffing-plan.js';
import { SeatSupply } from './supply.js';
import { buildStaffingTally } from './tally.js';
import { defendAgainstWildlife } from './wild-threats.js';

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
export { BUILDERS_PER_OPEN_SITE, CORE_BUILDERS, STALLED_BUILDER_CAP } from './staffing.js';
export { LATE_GAME_CIVILIANS, SUPPLY_CARRIER_GOODS_BY_BUILDING_ID } from './staffing-plan.js';
export { STAFFING_BY_BUILDING_ID } from './staffing-rows.js';
export { SeatSupply, type SupplyLine, type SupplyLines, supplyLines } from './supply.js';

const NO_GOODS: ReadonlySet<number> = new Set();

/** Whether `w`'s good is one the construction sites draw on ({@link COLLECTED_GOOD_IDS}). */
function buildsSites(w: WantedGood): boolean {
  return COLLECTED_GOOD_IDS.includes(w.good.id);
}

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
  const order = seatBuildOrder(world, ctx, player, fullOrder, profile);
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
  // While a placement is stalled the reserve shrinks to the open sites' pairs, so the clearing posts get
  // the men the missing sites would have had.
  const reserveLimit = builderCap(profile, civilians, ctx.tick);
  const builderLimit = clearing > 0 ? stalledBuilderLimit(world, ctx, owned, reserveLimit) : reserveLimit;
  const builderFloor = siteBuilderFloor(world, ctx, owned, builderLimit);
  const builders = seatBuilderCount(world, player, builderJob);
  const shortOfBuilders = builders < builderFloor;
  // The clearing posts yield the men the open sites' builders lack, so a stalled placement never keeps
  // its gatherers while the sites already standing wait for hands (authored: on ciezka_wspolpraca and
  // smocza_kraina, seed 7, seats with five to eight open sites kept four builders while five to seven
  // clearing gatherers piled 150-1060 wood).
  const clearingPosts = Math.max(0, clearing - Math.max(0, builderFloor - builders));
  // The core chain's next site (pottery, mason hut, then the bread chain) takes the reserve's builders
  // ahead of every other site, unless the seat is under attack; the gatherers of a good it waits on take one more post ahead of the reserve.
  const focus = underAttack(world, player) ? null : focusChainSite(world, ctx, owned);
  const focusShort = focus === null ? NO_GOODS : focusShortGoods(world, ctx, focus, supply);
  const allWanted = focusShortPosts(
    wantedCollectorGoods(world, ctx, player, order, statuses, supply),
    focusShort,
  );
  const rowWanted = shortOfBuilders ? rowPosts(allWanted) : allWanted;
  const baseNode = anchorNodeOf(world, base);
  const farGround =
    baseNode === null || shortOfBuilders
      ? 0
      : farGroundExtras(world, ctx, owned, baseNode, seatTuning(world, player).clearGroundPct);
  // A seat short of its core builders keeps no optional post: its standing generic posts, its free scout
  // and the gatherers of every good the sites do not build with go back to the pool the core claims from.
  const coreFloor = coreBuilderFloor(builderFloor);
  const shortHanded = builders < coreFloor;
  const genericTarget = (shortHanded ? 0 : GENERIC_COLLECTOR_TARGET) + clearingPosts + farGround;
  const classify = (posts: readonly WantedGood[]) =>
    classifyWorkforce(world, ctx, player, shortHanded ? posts.filter(buildsSites) : posts, genericTarget);
  let wanted = rowWanted;
  let classified = classify(wanted);
  // While the focus site rises, gatherers of the goods it does not wait on yield the men its
  // FOCUS_BUILDERS lack beyond the pool.
  const focusFloor = focus === null ? 0 : Math.min(FOCUS_BUILDERS, builderLimit);
  const spareMen = classified.pool.filter((e) => !apprentices.has(e)).length;
  if (spareMen < focusFloor) {
    wanted = focusYieldPosts(
      wanted,
      classified.collectorsByGood,
      focusShort,
      apprentices,
      focusFloor - spareMen,
    );
    classified = classify(wanted);
  }
  const { collectorsByGood, genericCollectors, fishers, roadsters } = classified;
  const freedScouts = shortHanded ? classified.scouts.filter((e) => scoutFree(world, e)) : [];
  const scouts =
    freedScouts.length === 0 ? classified.scouts : classified.scouts.filter((e) => !freedScouts.includes(e));
  const pool = freedScouts.length === 0 ? classified.pool : [...classified.pool, ...freedScouts];
  // An apprentice stays on the work earning his discovery, so no post takes him off it.
  const unschooled = apprentices.size === 0 ? pool : pool.filter((e) => !apprentices.has(e));
  // The wildlife answer comes first: the men it sends at an animal are off every other post.
  const wild = defendAgainstWildlife(world, ctx, player, owned, unschooled);
  const force = new SpareForce(
    wild.held.size === 0 ? unschooled : unschooled.filter((e) => !wild.held.has(e)),
  );
  const tally = buildStaffingTally(world, player, owned);
  const taken: TakenFlagNodes = new Set();
  const gated: GatedSlotSources = {
    promotions: new Promotions(world, ctx, player, apprentices),
    schooling: new Schooling(world, ctx, player, owned),
  };
  const seat: SeatStaffing = {
    player,
    owned,
    supply,
    profile,
    apprentices,
    breadChainOpen: breadChainUnfinished(world, ctx, owned),
  };
  const ground = collectorGround(world, ctx, player, seat.owned, baseNode);
  const fishing = fishingPlan(
    world,
    ctx,
    player,
    ground?.flags ?? null,
    fishers,
    fisherTarget(world, ctx, player, openingHomesStand(world, ctx, order, owned)),
  );
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
          clearing > 0 ? clearingAim(world, ctx, player, order, ground.baseNode) : undefined,
        );
  const firstPosts = (posts: (w: WantedGood) => boolean): PlayerCommand[] =>
    ground === null
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
          posts,
        );
  // The focus site's short goods, then its builders, come ahead of the other posts.
  const shortPosts = focusShort.size === 0 ? [] : firstPosts((w) => focusShort.has(w.good.typeId));
  const focusCore = reserveBuilders(world, force, builderJob, focusFloor, ctx);
  const sitePosts = [...shortPosts, ...firstPosts((w) => buildsSites(w) && !focusShort.has(w.good.typeId))];
  const firstFood = [
    ...staffBuildings(world, ctx, seat, force, tally, 'food', gated),
    ...allocateHunters(world, ctx, player, hunting, force, builderJob, tally, 'first'),
    ...allocateFishers(world, ctx, fishing, force, builderJob, taken, 'first'),
  ];
  const released = [
    ...releaseSurplusCarriers(world, ctx, seat, tally, builderJob),
    ...releaseSurplusOperators(world, ctx, seat, tally, builderJob),
  ];
  // The core builders come after the posts of the goods the sites draw on and the food (each food chain
  // workshop's first hand, the hunters and the fishers), and before the
  // other goods' posts, the standing buildings' first hands and the scout: on a seat of few men the ore
  // posts and the workshops otherwise took every man and left five sites without a builder for half an
  // hour (authored, battle_for_the_four_hills_multiplayer seeds 7 and 11).
  const core = reserveBuilders(world, force, builderJob, coreFloor - focusCore.reserved.length, ctx);
  const posted = [
    ...sitePosts,
    ...firstFood,
    ...released,
    ...firstPosts((w) => !buildsSites(w)),
    ...staffBuildings(world, ctx, seat, force, tally, 'min', gated),
  ];
  const scouting = allocateScout(world, ctx, player, order, scouts, force, builderJob);
  // The road crew comes out of the builder reserve, ahead of it, so a seat with road sites always has
  // its roadster.
  const roadCrew = allocateRoadCrew(world, ctx, player, roadsters, force, builderJob);
  // Construction never starves. The road crew is part of the reserve. The army floor may reclaim the
  // reserve past its core (`garrison.ts`), so its fresh men's commands wait.
  const reserveCap = Math.max(0, builderLimit - roadCrew.crew);
  const claimed = focusCore.reserved.length + core.reserved.length;
  const rest = reserveBuilders(world, force, builderJob, reserveCap - claimed, ctx);
  const reserve = {
    commands: [...focusCore.commands, ...core.commands, ...rest.commands],
    reserved: [...focusCore.reserved, ...core.reserved, ...rest.reserved],
  };
  // While the seat's catch feeds its women, the focus site pins only its floor and the other builders
  // keep the homes and the other sites.
  const focusCrew =
    focus === null
      ? []
      : focusCrewOrders(
          world,
          ctx,
          player,
          focus,
          reserve.reserved,
          builderJob,
          (good) => supply.units(good),
          fishFeedsWomen(world, ctx, player) ? focusFloor : null,
        );
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
    men: upperReserve(reserve.reserved, reserveCap, builderFloor),
    builderJob,
    gatherers: calledGatherers(world, ctx, player, collectorsByGood, supply, apprentices),
  });
  const drafted = new Set(armyFloor.men);
  const undrafted = (c: PlayerCommand): boolean => !('entity' in c && drafted.has(c.entity));
  return [
    ...flagFollowSwitch(world, player),
    ...settlementGrantOrders(world, ctx, player),
    ...wild.commands,
    ...posted.filter(undrafted),
    ...scouting,
    ...roadCrew.commands,
    ...reserve.commands.filter(undrafted),
    ...focusCrew.filter(undrafted),
    ...targets,
    ...armyFloor.commands,
    ...allocateFishers(world, ctx, fishing, force, builderJob, taken, 'topUp'),
    ...allocateHunters(world, ctx, player, hunting, force, builderJob, tally, 'surplus'),
    ...staffBuildings(world, ctx, seat, force, tally, 'surplus', gated),
    ...(clearing > 0 ? [] : generic()),
    ...trainGarrison(world, ctx, player, force, armyFloor.men, arms, profile),
    ...tuneCraftCounters(world, ctx, player, supply, profile, apprentices),
    ...gated.schooling.teachMethods(),
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
 *  atomic. Only an unwed man is hired, not one walking to his wedding either (authored: a scout is away on a mission and his wife would
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
  const unwed = (e: Entity): boolean => isUnwed(world, e);
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
  if (scoutJob !== null && scouts.length === 0 && force.any(unwed) && hasScoutWork()) {
    const spare = force.take(unwed);
    if (spare !== null) commands.push({ kind: 'setJob', entity: spare, jobType: scoutJob });
  }
  for (const [i, scout] of scouts.entries()) {
    if (!scoutFree(world, scout) || builderJob === null) continue;
    if (i === 0 && scoutJob !== null && hasScoutWork()) continue; // the working scout - keep
    commands.push({ kind: 'setJob', entity: scout, jobType: builderJob });
  }
  return commands;
}

/** Whether a scout may change trade: not mid-action, which `setJob` would cancel, and on no order. */
function scoutFree(world: World, scout: Entity): boolean {
  return !(
    world.has(scout, CurrentAtomic) ||
    world.has(scout, ErectSignpostOrder) ||
    world.has(scout, PlayerOrder)
  );
}

export function workforceModule(order: BuildOrder): ComputerModule {
  return {
    id: 'collectResources',
    run: (world, ctx, player) => [
      ...demobilizeStartSoldiers(world, ctx, player, builderJobOf(ctx)),
      ...runWorkforce(world, ctx, player, order),
    ],
    everyDecisions: WORKFORCE_EVERY_DECISIONS,
  };
}
