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
import { constructionWorkCell } from '../../../footprint/index.js';
import {
  bankedSlot,
  buildingProduces,
  type InboundSupplyTally,
  inboundSupplyOf,
  mergedRecipeOf,
  refillsOwnStock,
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
 * never receives a search area: home is reachable by definition. A `searched` rule scans for a sink and
 * must therefore respect the confinement.
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

/** Where a searched rule may look: the settler's signpost confinement plus its failed-goal veto, vetoed by
 *  cell and, for a site walked at a perimeter stand, by that stand. */
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
  // An input must land as itself: a workshop that would shelve it converted feeds its own recipe nothing,
  // so the load falls through to a real sink.
  if (bankedSlot(world, ctx, workplace, goodType).goodType !== goodType) return null;
  return hasRoom(world, ctx, workplace, goodType) ? workplace : null;
}

/** A flag-bound gatherer banks its harvest at its own flag. The flag carries no `Stockpile` - the load
 *  spreads onto loose ground heaps around it, each pinned to its tile - so there is no capacity gate. */
function toOwnDeliveryFlag(plan: PlannerContext): DeliveryVerdict {
  const { world, entity } = plan;
  const flag = world.tryGet(entity, WorkFlag)?.flag;
  if (flag === undefined) return null;
  return world.has(flag, DeliveryFlag) && world.has(flag, Position) ? flag : null;
}

/**
 * A farm's carrier clears the farm's own crop to storage, every producer of the good excluded so the load
 * reaches a warehouse and never another farm. Owns the outcome: with no storage in reach the crop stays put,
 * because falling through to `toBoundStorage` would bank it straight back into the farm it just left.
 *
 * Keyed on the good's `farming` block rather than on recipe absence: the asset pipeline synthesizes a recipe
 * for every producing building, so a recipe test would turn this rung off under extracted content.
 */
function toStorageOffFarm(plan: PlannerContext, goodType: number, area: DeliverySearchArea): DeliveryVerdict {
  const { world, ctx, here, jobType, tribe, owner, targets } = plan;
  const home = boundWorkplace(plan);
  if (home === undefined) return null;
  if (!isFarmCarrierHaulOutRole(world, ctx, home, jobType, tribe)) return null;
  if (!buildingProduces(world, ctx, home).includes(goodType)) return null;
  const store = nearestStoreFor(
    targets.bands,
    world,
    here,
    goodType,
    owner,
    /* excludeProducers */ true,
    area.gate,
    area.avoid,
  );
  return store ?? 'no-sink';
}

/** A store-posted settler's or farmer's load goes to the storage it is bound to: a warehouse, a flag pile,
 *  or the farm's own store when a farmer banks its sheaf and the farm still has room. */
function toBoundStorage(plan: PlannerContext, goodType: number): DeliveryVerdict {
  const { world, ctx } = plan;
  const home = boundWorkplace(plan);
  if (home === undefined) return null;
  return isStorageSink(world, ctx, home) && hasRoom(world, ctx, home, goodType) ? home : null;
}

/** The settler's own site: a builder's crew pin, or the unfinished workplace a worker is posted to. Bound,
 *  so it stays unconfined: the player's pin may point beyond the signpost area and a confined delivery
 *  would shuttle the material back to its source forever. */
function toOwnCrewSite(plan: PlannerContext, goodType: number): DeliveryVerdict {
  const { world, ctx, entity, tribe, owner, inbound } = plan;
  const crew = world.tryGet(entity, SiteAssignment)?.site ?? boundWorkplace(plan);
  if (crew === undefined) return null;
  if (!constructionSiteNeeds(world, ctx, crew, tribe, owner, goodType, inbound)) return null;
  return constructionSiteCanReceive(plan, crew) ? crew : 'no-sink';
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
        constructionSiteNeeds(world, ctx, e, tribe, owner, goodType, inbound) &&
        constructionSiteCanReceive(plan, e) &&
        area.avoidSite?.(e) !== true
          ? QUALIFIES
          : null,
      area.gate,
    )?.entity ?? null
  );
}

/** Whether a site's material can physically land on a legal perimeter cell. */
function constructionSiteCanReceive(plan: PlannerContext, site: Entity): boolean {
  const { world, ctx, terrain, here, targets } = plan;
  return constructionWorkCell(world, ctx, terrain, site, targets.yard.blocked, here) !== null;
}

/**
 * A carrier posted at a self-filling house (the well, the hive) takes its good to the nearest built recipe
 * consumer with room for it, and only with none to storage: original behavior. A site still under
 * construction is skipped: it needs delivered build material, not a recipe input. No land-as-itself guard
 * is needed here, since `carriedGoodForm` already converted any dish this carrier holds.
 */
function toNearbyRecipeConsumer(
  plan: PlannerContext,
  goodType: number,
  area: DeliverySearchArea,
): DeliveryVerdict {
  const { world, ctx, here, owner, targets } = plan;
  const home = boundWorkplace(plan);
  if (home === undefined || !refillsOwnStock(world, ctx, home)) return null;
  if (!buildingProduces(world, ctx, home).includes(goodType)) return null;
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
  const { world, here, owner, targets } = plan;
  return nearestStoreFor(targets.bands, world, here, goodType, owner, false, area.gate, area.avoid);
}

function boundWorkplace(plan: PlannerContext): Entity | undefined {
  return plan.world.tryGet(plan.entity, JobAssignment)?.workplace;
}

/** Whether construction site `e` still has room for `goodType` in its bill. Counts what the site holds plus
 *  other settlers' live supply errands, so a unit already on someone's back attracts no duplicate fetch. */
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
