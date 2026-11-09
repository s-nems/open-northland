import {
  Building,
  Carrying,
  HaulingCart,
  JobAssignment,
  keepsStorageMinimums,
  ownerOf,
  PickupClaim,
  Position,
  prioritizesGood,
  Stockpile,
  sameSideAs,
  storageMinimumGoods,
  storePriorityGoods,
  VehicleStock,
} from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SpatialGate } from '../../../../nav/node-circle.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { WORKPLACE_COLLECT_RADIUS } from '../../../economy/haul-flag.js';
import { buildingBlockedCells } from '../../../footprint/index.js';
import { edibleClassOf } from '../../../readviews/food.js';
import { entityNode } from '../../../spatial/nodes.js';
import { assignedWorkers } from '../../../stores/assigned-workers.js';
import {
  bankedSlot,
  buildingProduces,
  isLoosePile,
  isStorehouseType,
  lowestStockedGood,
  type SupplyTally,
} from '../../../stores/index.js';
import type { PlannerContext } from '../../planner/context.js';
import {
  haulableOutputGood,
  type NearestByCell,
  nearerOf,
  type Qualified,
  qualifiedGood,
  storageBelowMinimum,
  strandedPile,
  unclaimedGoodsAt,
  unclaimedStockOf,
} from '../../targets/index.js';
import { unreachableGoalVeto } from '../../unreachable-goals.js';
import { carriedGoodForm, deliverySinkProbe, homeBoundGoodProbe } from './delivery-targets.js';
import { haulFlagArea, workAreaGate } from './haul-flag-area.js';
import { isFarmCarrierHaulOutRole } from './store-policy.js';

/**
 * The nearest loose pickup a porter should make and the good to lift, or null when none is within reach.
 * Without a flag it is a ground pile within {@link WORKPLACE_COLLECT_RADIUS} of its workplace, ranked
 * from the porter. With one it is a ground pile or a workplace's finished output inside the flag's area,
 * ranked from the flag. Original behavior: a carrier's search around its work point takes both.
 * Approximation: the original favours a ground heap lying a few steps beyond the nearest such building,
 * and picks at random among the finds; here plain distance decides.
 *
 * A ground pile is an {@link isLoosePile} heap not buried under a building's walls or out of every unit's
 * reach; a wall or road site's delivered material is never one. The good lifted is the pile's lowest-id
 * stocked one passing `deliverable`, and the scan is canonical by Manhattan distance then ascending cell
 * id. The tests run per candidate, so a lift or claim earlier in the pass is seen by the next porter, and
 * a good every unit of which a walker already claimed is passed over.
 */
function nearestLoosePickup(
  plan: PlannerContext,
  deliverable: (goodType: number) => boolean,
): { from: Entity; goodType: number } | null {
  const { world, ctx, terrain, here, targets, supply } = plan;
  const walls = buildingBlockedCells(world, ctx, terrain);
  const groundPileGood = (e: Entity): Qualified<number> | null => {
    if (!isLoosePile(world, e)) return null;
    const unclaimed = unclaimedGoodsAt(world, ctx, supply, e);
    const good = lowestStockedGood(
      world.get(e, Stockpile),
      (g) => (unclaimed?.(g) ?? true) && deliverable(g),
    );
    if (good === null) return null;
    return strandedPile(world, ctx, terrain, walls, e) ? null : { payload: good };
  };
  const avoid = unreachableGoalVeto(world, ctx, plan.entity);
  const onSide = sameSideAs(world, plan.owner);
  const area = haulFlagArea(plan);
  if (area === null) {
    const collect = workplaceCollectGate(plan);
    const loose =
      collect === null
        ? null
        : targets.stockpileCells.nearestLoose(here, groundPileGood, collect, avoid, onSide);
    return loose === null ? null : { from: loose.entity, goodType: loose.payload };
  }
  const best = targets.stockpileCells.nearest(
    here,
    (e) =>
      world.has(e, Building)
        ? qualifiedGood(haulableOutputGood(world, ctx, supply, deliverable, e))
        : groundPileGood(e),
    area.gate,
    avoid,
    onSide,
    area.center,
  );
  return best === null ? null : { from: best.entity, goodType: best.payload };
}

/**
 * While its player's storehouses hold less of a good than the storage minimum, a porter posted at a
 * storehouse or the headquarters fetches it first (our rule): the nearest unclaimed unit in a workplace's
 * finished output, a self-filling house or a ground pile, a dish counting as the food it becomes. Only a
 * load bound for the porter's own storehouse qualifies, so the delivery cannot turn elsewhere on the way.
 * With a flag it looks inside the flag's area, without one anywhere it may fetch goods. The search walks
 * the holders of each short good, ascending by good. A unit already on its way still counts as missing,
 * so several porters may overshoot the minimum by a load each.
 */
function nearestMinimumRestock(
  plan: PlannerContext,
  sinkOf: (goodType: number) => Entity | null,
): { from: Entity; goodType: number } | null {
  const { world, ctx, entity, here, owner, targets, supply } = plan;
  if (owner === undefined || !keepsStorageMinimums(world, owner)) return null;
  const home = world.tryGet(entity, JobAssignment)?.workplace;
  if (home === undefined || ownerOf(world, home) !== owner) return null;
  const homeType = world.tryGet(home, Building)?.buildingType;
  if (homeType === undefined || !isStorehouseType(ctx.content, homeType)) return null;

  let lifted = 0;
  const lifts = (goodType: number): boolean => goodType === lifted;
  const accept = (e: Entity): Qualified<number> | null => {
    if (world.has(e, Building)) return qualifiedGood(haulableOutputGood(world, ctx, supply, lifts, e));
    return isLoosePile(world, e) && unclaimedStockOf(world, ctx, supply, e, lifted) > 0
      ? { payload: lifted }
      : null;
  };
  // Built on the first short good with holders, so a porter whose minimums are met pays for no gate.
  let search: RestockSearch | null = null;
  const nearestHolder = (minimumGood: number, goodType: number): NearestByCell<number> | null => {
    if (carriedGoodForm(world, ctx, entity, goodType) !== minimumGood || sinkOf(goodType) !== home)
      return null;
    const holders = targets.bands.holding(goodType);
    if (!holders.hasCandidates()) return null;
    search ??= restockSearch(plan, owner);
    lifted = goodType;
    return holders.nearest(here, accept, search.gate, search.avoid, sameSideAs(world, owner), search.rank);
  };
  let best: NearestByCell<number> | null = null;
  for (const minimumGood of storageMinimumGoods(world, owner)) {
    if (!storageBelowMinimum(world, ctx, owner, minimumGood)) continue;
    const edibles = edibleClassOf(ctx.content, minimumGood);
    if (edibles.length === 0) best = nearerOf(best, nearestHolder(minimumGood, minimumGood));
    for (const goodType of edibles) best = nearerOf(best, nearestHolder(minimumGood, goodType));
  }
  return best === null ? null : { from: best.entity, goodType: best.payload };
}

/** Where a restock search looks: the flag's area or the goods reach, ranked from the flag or the porter. */
interface RestockSearch {
  readonly gate: SpatialGate | undefined;
  readonly rank: NodeId;
  readonly avoid: ((cell: NodeId) => boolean) | undefined;
}

function restockSearch(plan: PlannerContext, owner: number): RestockSearch {
  const { world, ctx, entity, here, targets } = plan;
  const area = haulFlagArea(plan);
  return {
    gate: area?.gate ?? targets.bands.goodsGate(here, owner, plan.limit ?? undefined),
    rank: area?.center ?? here,
    avoid: unreachableGoalVeto(world, ctx, entity),
  };
}

/**
 * The nearest unit of a good the porter's own store marks as priority (our rule), while the store has
 * room for it: in another of the owner's storehouses that does not prioritize the good too, in a
 * workplace's finished output or in a ground heap. Searched like {@link nearestMinimumRestock}, ascending
 * by good, and only a load the porter carries as itself and delivers home qualifies. The lift is capped
 * at the room its fellow porters' loads and claims leave, so no surplus walks back to its source.
 * A storehouse source lends only past the owner's storage minimum, even to another storehouse.
 */
function nearestPriorityRestock(
  plan: PlannerContext,
  sinkOf: (goodType: number) => Entity | null,
): PorterPickup | null {
  const { world, ctx, entity, here, owner, targets, supply } = plan;
  const home = world.tryGet(entity, JobAssignment)?.workplace;
  if (home === undefined || owner === undefined) return null;
  const goods = storePriorityGoods(world, home);
  if (goods.length === 0 || ownerOf(world, home) !== owner) return null;

  let lifted = 0;
  const lifts = (goodType: number): boolean => goodType === lifted;
  const accept = (e: Entity): Qualified<number> | null => {
    if (e === home) return null;
    const type = world.tryGet(e, Building)?.buildingType;
    if (type === undefined) {
      return isLoosePile(world, e) && unclaimedStockOf(world, ctx, supply, e, lifted) > 0
        ? { payload: lifted }
        : null;
    }
    if (!isStorehouseType(ctx.content, type)) {
      return qualifiedGood(haulableOutputGood(world, ctx, supply, lifts, e));
    }
    return ownerOf(world, e) === owner &&
      !prioritizesGood(world, e, lifted) &&
      unclaimedStockOf(world, ctx, supply, e, lifted) > 0
      ? { payload: lifted }
      : null;
  };
  let search: RestockSearch | null = null;
  let best: NearestByCell<number> | null = null;
  let bestRoom = 0;
  for (const goodType of goods) {
    const room = roomLeftForPorters(plan, home, goodType);
    if (room <= 0) continue;
    if (carriedGoodForm(world, ctx, entity, goodType) !== goodType || sinkOf(goodType) !== home) continue;
    const holders = targets.bands.holding(goodType);
    if (!holders.hasCandidates()) continue;
    search ??= restockSearch(plan, owner);
    lifted = goodType;
    const found = holders.nearest(
      here,
      accept,
      search.gate,
      search.avoid,
      sameSideAs(world, owner),
      search.rank,
    );
    const nearer: NearestByCell<number> | null = nearerOf(best, found);
    if (nearer !== best) bestRoom = room;
    best = nearer;
  }
  return best === null ? null : { from: best.entity, goodType: best.payload, amount: bestRoom };
}

/** The units of `goodType` `home`'s shelf still takes once the loads its other porters carry, have
 *  claimed or hold in their carts land. A stow between hands and hold keeps the sum, so a dormant porter's
 *  verdict rests only on versioned writes. */
export function roomLeftForPorters(plan: PlannerContext, home: Entity, goodType: number): number {
  const { world, ctx, entity } = plan;
  const slot = bankedSlot(world, ctx, home, goodType);
  if (slot.goodType !== goodType) return 0;
  let room = slot.capacity - (world.get(home, Stockpile).amounts.get(goodType) ?? 0);
  for (const porter of assignedWorkers(world, home)) {
    if (porter !== entity) room -= porterLoadOf(world, porter, goodType);
  }
  return room;
}

/** The units of `goodType` `porter` is bringing: in hand, claimed at a source and aboard its cart. */
export function porterLoadOf(world: World, porter: Entity, goodType: number): number {
  let load = 0;
  const carried = world.tryGet(porter, Carrying);
  if (carried?.goodType === goodType) load += carried.amount;
  const claim = world.tryGet(porter, PickupClaim);
  if (claim?.goodType === goodType) load += claim.amount;
  const cart = world.tryGet(porter, HaulingCart)?.vehicle;
  const hold = cart === undefined ? undefined : world.tryGet(cart, VehicleStock);
  load += hold?.lines.get(goodType)?.current ?? 0;
  return load;
}

/** A porter's pickup: where, which good, and at most how many units when the rung caps the lift. */
export interface PorterPickup {
  readonly from: Entity;
  readonly goodType: number;
  readonly amount?: number;
}

/** The pickup area of a porter without a flag: {@link WORKPLACE_COLLECT_RADIUS} around its workplace,
 *  inside its signpost confinement. Null, so nothing is lifted, for a porter with no positioned workplace. */
function workplaceCollectGate(plan: PlannerContext): SpatialGate | null {
  const { world, terrain, limit } = plan;
  const workplace = world.tryGet(plan.entity, JobAssignment)?.workplace;
  if (workplace === undefined || !world.has(workplace, Position)) return null;
  return workAreaGate(terrain, entityNode(world, terrain, workplace), WORKPLACE_COLLECT_RADIUS, limit);
}

/**
 * The finished output a carrier bound to a producing building should haul out to a warehouse, or null when
 * there is nothing to haul. A candidate is a good the building's type produces, stocks beyond what other
 * settlers walking to it have claimed, and this carrier could deliver somewhere; walked in `produces`
 * order, so the pick never depends on store insertion history.
 *
 * Scoped to a bound building whose produced good is field-farmed (a `farming` block), since a recipe
 * workshop's output is already hauled by the producer loop. Keying on the absence of a recipe instead would
 * silently disable this under extracted content, where the pipeline synthesizes a recipe for every
 * producing building. Gated to a non-field-worker so a farmer never lifts the farm's wheat only to bank it
 * straight back.
 */
export function boundProducerOutputToHaul(
  deliverable: (goodType: number) => boolean,
  world: World,
  ctx: SystemContext,
  settler: Entity,
  jobType: number,
  supply: SupplyTally,
): { home: Entity; goodType: number } | null {
  const binding = world.tryGet(settler, JobAssignment);
  if (binding === undefined) return null;
  const home = binding.workplace;
  // The role gate is shared with `toStorageOffFarm`, so pickup and delivery routing cannot disagree.
  if (!isFarmCarrierHaulOutRole(world, ctx, home, jobType)) return null;
  if (!world.has(home, Stockpile) || !world.has(home, Position)) return null;
  const stock = world.get(home, Stockpile).amounts;
  for (const goodType of buildingProduces(world, ctx, home)) {
    if ((stock.get(goodType) ?? 0) <= supply.reservedAt(home, goodType)) continue;
    if (deliverable(goodType)) {
      return { home, goodType };
    }
  }
  return null;
}

/**
 * The porter rung's pickup decision, side-effect-free so the dormancy verifier can re-run it without
 * mutating state: the bound producer's output out first, then a good its store marks as priority, then
 * a good short of its storage minimum, else the nearest loose pickup in. The loose pickup, like a
 * flagged porter's output pickup, lifts only a good bound for the porter's own store.
 */
export function porterPickupTarget(plan: PlannerContext): PorterPickup | null {
  // One routing memo for both probes.
  const sinkOf = deliverySinkProbe(plan);
  const deliverable = (goodType: number): boolean => sinkOf(goodType) !== null;
  const haul = boundProducerOutputToHaul(
    deliverable,
    plan.world,
    plan.ctx,
    plan.entity,
    plan.jobType,
    plan.supply,
  );
  if (haul !== null) return { from: haul.home, goodType: haul.goodType };
  return (
    nearestPriorityRestock(plan, sinkOf) ??
    nearestMinimumRestock(plan, sinkOf) ??
    nearestLoosePickup(plan, homeBoundGoodProbe(plan))
  );
}
