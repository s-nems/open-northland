import {
  Building,
  DeliveryFlag,
  JobAssignment,
  ownerOf,
  ownersCompatible,
  Position,
  SiteAssignment,
  Stockpile,
  sameSideAs,
  UnderConstruction,
  WorkFlag,
} from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SpatialGate } from '../../../../nav/node-circle.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import {
  buildingProduces,
  type InboundSupplyTally,
  inboundSupplyOf,
  mergedRecipeOf,
  producesGoodWithoutInputs,
  stockCapacity,
} from '../../../stores/index.js';
import type { PlannerContext } from '../../planner/context.js';
import {
  boundWorkplaceTarget,
  nearestStoreFor,
  QUALIFIES,
  unreachableSiteStand,
} from '../../targets/index.js';
import { unreachableGoalVeto } from '../../unreachable-goals.js';
import { hasRoom, isFarmCarrierHaulOutRole, isStorageSink } from './store-policy.js';

/**
 * A rule's answer for one carried load: the sink to deliver to, `'no-sink'` when the rule owns the
 * routing and nothing qualifies, or null when the load is not its case and the next rule decides.
 */
export type DeliveryVerdict = Entity | 'no-sink' | null;

/**
 * One rung of the delivery ladder. A `bound` rule routes to a target the settler is already tied to and
 * never receives the {@link DeliverySearchArea}: a settler always knows the way home, so its own workshop,
 * flag, storage or crew site is reachable by definition. A `searched` rule scans for a sink and must
 * therefore respect the confinement.
 */
export type DeliveryRule =
  | { readonly kind: 'bound'; readonly resolve: (plan: PlannerContext, goodType: number) => DeliveryVerdict }
  | {
      readonly kind: 'searched';
      readonly resolve: (plan: PlannerContext, goodType: number, area: DeliverySearchArea) => DeliveryVerdict;
    };

export const DELIVERY_RULES: readonly DeliveryRule[] = [
  { kind: 'bound', resolve: toConsumingWorkplace },
  { kind: 'bound', resolve: toOwnDeliveryFlag },
  { kind: 'searched', resolve: toStorageOffFarm },
  { kind: 'bound', resolve: toBoundStorage },
  { kind: 'bound', resolve: toOwnCrewSite },
  { kind: 'searched', resolve: toNeedingConstructionSite },
  { kind: 'searched', resolve: toNearbyRecipeConsumer },
  { kind: 'searched', resolve: toNearestCapableStore },
];

/** Where a searched rule may look: the settler's signpost confinement plus its failed-goal veto, keyed
 *  both by cell and (for sites, which are walked at a perimeter stand) by the stand a delivery would take. */
export interface DeliverySearchArea {
  readonly gate: SpatialGate | undefined;
  readonly avoid: ((cell: NodeId) => boolean) | undefined;
  readonly avoidSite: ((site: Entity) => boolean) | undefined;
}

export function deliverySearchArea(plan: PlannerContext): DeliverySearchArea {
  const { world, ctx, terrain, entity, here, targets } = plan;
  const avoid = unreachableGoalVeto(world, ctx, entity);
  return {
    gate: plan.limit ?? undefined,
    avoid,
    avoidSite: unreachableSiteStand(world, ctx, terrain, targets.yard.blocked, here, avoid),
  };
}

/** A fetched input goes to the bound workshop that consumes it, so a picked-up input is never
 *  re-deposited into the warehouse it came from. */
function toConsumingWorkplace(plan: PlannerContext, goodType: number): DeliveryVerdict {
  const { world, ctx, entity, jobType, tribe } = plan;
  const workplace = boundWorkplaceTarget(world, ctx, entity, jobType, tribe);
  if (workplace === null) return null;
  const recipe = mergedRecipeOf(world, ctx, workplace);
  if (recipe?.inputs.some((i) => i.goodType === goodType) !== true) return null;
  return hasRoom(world, ctx, workplace, goodType) ? workplace : null;
}

/** A flag-bound gatherer banks its harvest at its own flag. The flag carries no {@link Stockpile} - the
 *  load spreads onto loose ground heaps around it, each pinned to its tile - so there is no capacity gate. */
function toOwnDeliveryFlag(plan: PlannerContext): DeliveryVerdict {
  const { world, entity } = plan;
  const flag = world.tryGet(entity, WorkFlag)?.flag;
  if (flag === undefined) return null;
  return world.has(flag, DeliveryFlag) && world.has(flag, Position) ? flag : null;
}

/**
 * A farm's CARRIER clears the farm's own crop to storage, every producer of the good excluded so the load
 * reaches a warehouse and never another farm. Owns the outcome: with no storage in reach the crop stays put,
 * because falling through to {@link toBoundStorage} would bank it straight back into the farm it just left.
 *
 * Keyed on the good's `farming` block rather than on recipe absence: the asset pipeline synthesizes a recipe
 * for every producing building, so a recipe test would silently turn this rung off under extracted content.
 */
function toStorageOffFarm(plan: PlannerContext, goodType: number, area: DeliverySearchArea): DeliveryVerdict {
  const { world, ctx, here, jobType, tribe, owner, targets } = plan;
  const home = boundWorkplace(plan);
  if (home === undefined) return null;
  if (!isFarmCarrierHaulOutRole(world, ctx, home, jobType, tribe)) return null;
  if (!buildingProduces(world, ctx, home).includes(goodType)) return null;
  const store = nearestStoreFor(
    targets.stockpileCells,
    world,
    ctx,
    here,
    goodType,
    owner,
    /* excludeProducers */ true,
    area.gate,
    area.avoid,
  );
  return store ?? 'no-sink';
}

/** A porter's or farmer's load goes to the storage it is bound to: a warehouse, a flag pile, or the farm's
 *  own store when a farmer banks its sheaf and the farm still has room. */
function toBoundStorage(plan: PlannerContext, goodType: number): DeliveryVerdict {
  const { world, ctx } = plan;
  const home = boundWorkplace(plan);
  if (home === undefined) return null;
  return isStorageSink(world, ctx, home) && hasRoom(world, ctx, home, goodType) ? home : null;
}

/** A builder's own crew site. Bound, so it stays unconfined: the player's pin may point beyond the signpost
 *  area and `planBuilder` fetches for it regardless - a confined delivery would disagree with that fetch and
 *  shuttle the material back to its source forever. */
function toOwnCrewSite(plan: PlannerContext, goodType: number): DeliveryVerdict {
  const { world, ctx, entity, tribe, owner, inbound } = plan;
  const crew = world.tryGet(entity, SiteAssignment)?.site;
  if (crew === undefined) return null;
  return constructionSiteNeeds(world, ctx, crew, tribe, owner, goodType, inbound) ? crew : null;
}

/** Construction material flows to the nearest site of the settler's own player that still has room in its
 *  bill, so a builder self-supplying its foundation (and any hauler topping it up) reaches the site instead
 *  of shuttling the material into a warehouse. */
function toNeedingConstructionSite(
  plan: PlannerContext,
  goodType: number,
  area: DeliverySearchArea,
): DeliveryVerdict {
  const { world, ctx, here, tribe, owner, inbound, targets } = plan;
  return (
    targets.constructionSiteCells.nearest(
      here,
      (e) =>
        constructionSiteNeeds(world, ctx, e, tribe, owner, goodType, inbound) && area.avoidSite?.(e) !== true
          ? QUALIFIES
          : null,
      area.gate,
    )?.entity ?? null
  );
}

/**
 * A carrier posted at an input-less UTILITY (the well, the hive) feeds that utility's output to a nearby
 * BUILT recipe consumer - the bakery's water, the brewery's honey - before central storage, banking only the
 * surplus later (user rule 2026-07-19). A site still under construction is skipped: it needs delivered build
 * material, not a recipe input.
 */
function toNearbyRecipeConsumer(
  plan: PlannerContext,
  goodType: number,
  area: DeliverySearchArea,
): DeliveryVerdict {
  const { world, ctx, here, owner, targets } = plan;
  const home = boundWorkplace(plan);
  if (home === undefined || !producesGoodWithoutInputs(world, ctx, home, goodType)) return null;
  return (
    targets.stockpileCells.nearest(
      here,
      (e) => {
        if (world.has(e, UnderConstruction)) return null;
        const recipe = mergedRecipeOf(world, ctx, e);
        if (recipe === undefined || !recipe.inputs.some((i) => i.goodType === goodType)) return null;
        return hasRoom(world, ctx, e, goodType) ? QUALIFIES : null;
      },
      area.gate,
      area.avoid,
      sameSideAs(world, owner),
    )?.entity ?? null
  );
}

/** The nearest store that can stock the good - the default for an unbound hauler. */
function toNearestCapableStore(
  plan: PlannerContext,
  goodType: number,
  area: DeliverySearchArea,
): DeliveryVerdict {
  const { world, ctx, here, owner, targets } = plan;
  return nearestStoreFor(
    targets.stockpileCells,
    world,
    ctx,
    here,
    goodType,
    owner,
    false,
    area.gate,
    area.avoid,
  );
}

function boundWorkplace(plan: PlannerContext): Entity | undefined {
  return plan.world.tryGet(plan.entity, JobAssignment)?.workplace;
}

/** Whether construction site `e` (of this settler's side) still has room for `goodType` in its bill. Counts
 *  both what the site holds and what other settlers' live supply errands already have inbound, so a unit
 *  already on someone's back stops attracting a duplicate fetch. */
function constructionSiteNeeds(
  world: World,
  ctx: SystemContext,
  e: Entity,
  tribe: number,
  owner: number | undefined,
  goodType: number,
  inbound: InboundSupplyTally,
): boolean {
  if (!world.has(e, UnderConstruction) || !world.has(e, Building)) return false;
  if (world.get(e, Building).tribe !== tribe) return false;
  if (!ownersCompatible(owner, ownerOf(world, e))) return false; // another player's site (same tribe isn't same side)
  const have = (world.get(e, Stockpile).amounts.get(goodType) ?? 0) + inboundSupplyOf(inbound, e, goodType);
  return have < stockCapacity(world, ctx, e, goodType);
}
