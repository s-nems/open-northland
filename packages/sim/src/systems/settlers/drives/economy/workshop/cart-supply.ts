import type { Recipe } from '@open-northland/data';
import { Stockpile } from '../../../../../components/index.js';
import type { Entity } from '../../../../../ecs/world.js';
import { manhattan } from '../../../../spatial/metric.js';
import { haulingCartGoods, haulingCartUnits, pullsHaulingCart } from '../../../../vehicles/hauling-cart.js';
import type { PlannerContext } from '../../../planner/context.js';
import { interactionCell } from '../../../targets/index.js';
import { deliverableGoodProbe, deliveryTargetFor, sinkRoomFor } from '../delivery-targets.js';
import { haulFlagArea } from '../haul-flag-area.js';
import type { WorkSeatClaims } from './index.js';
import {
  type InputShortfall,
  type MissingInputSource,
  nearestMissingInputSource,
  workplaceOutputToHaul,
} from './supply.js';

/** The next lift of a cart's round: up to `units` of `goodType` off `from`. */
export interface CartPickup {
  readonly from: Entity;
  readonly goodType: number;
  readonly units: number;
  /** `from` is a self-filling house of the good, which a fetch claims nothing at. */
  readonly refills: boolean;
  /** The workplace whose input this is, null for a load bound for a store. */
  readonly supplies: Entity | null;
}

/** The source of the input `workplace`'s carrier restocks next, a flagged carrier's own pickup area
 *  searched before the stores elsewhere (owner ruling). */
export function carrierInputSource(
  plan: PlannerContext,
  workplace: Entity,
  supply: Recipe,
  shortfall: InputShortfall,
): MissingInputSource | null {
  const area = haulFlagArea(plan);
  return (
    (area === null ? null : nearestMissingInputSource(plan, workplace, supply, shortfall, area)) ??
    nearestMissingInputSource(plan, workplace, supply, shortfall)
  );
}

/**
 * The next stop of a workshop carrier's cart round (named addition). Beside its own workplace it loads
 * the next finished output a store takes, so one trip out carries every product. With an input aboard,
 * or nothing aboard that a store takes, it goes on to the source of the input still shortest of its
 * slot, the units aboard counted as stocked: a source that held a unit or two does not end the trip, and
 * a product no store has room for does not keep the inputs waiting, nor the products a store does take:
 * with no input to fetch it loads those. Inputs aboard go on only as far as {@link extendsFetchTo}
 * allows.
 */
export function workshopCartPickup(
  plan: PlannerContext,
  workplace: Entity,
  seatClaims: WorkSeatClaims,
  beside: Entity | null,
  room: number,
  mixes: (goodType: number) => boolean,
): CartPickup | null {
  const { world, ctx, entity: e } = plan;
  const outputPickup = (): CartPickup | null => {
    const deliverable = deliverableGoodProbe(plan);
    const takes = (goodType: number): boolean => mixes(goodType) && deliverable(goodType);
    const output = workplaceOutputToHaul(takes, world, ctx, plan.supply, workplace);
    if (output === null) return null;
    const units = Math.min(room, sinkRoomFor(plan, output));
    return { from: workplace, goodType: output, units, refills: false, supplies: null };
  };
  if (beside === workplace) return outputPickup();
  const supply = seatClaims.carrierRecipe(world, ctx, workplace);
  if (supply === undefined) return null;
  const aboard = haulingCartGoods(world, e);
  const fetching = supply.inputs.some((input) => aboard.includes(input.goodType));
  if (!fetching && aboard.some((goodType) => deliveryTargetFor(plan, goodType) !== null)) return null;
  const source = carrierInputSource(plan, workplace, supply, {
    restockToCapacity: true,
    // An input that rides in the hands counts as stocked: it is fetched on a trip of its own.
    inbound: (goodType) =>
      mixes(goodType) ? haulingCartUnits(world, e, goodType) : Number.POSITIVE_INFINITY,
  });
  if (source === null) return fetching || beside !== null ? null : outputPickup();
  if (
    fetching &&
    !extendsFetchTo(plan, workplace, crewRecipes(plan, workplace, seatClaims, supply), source)
  ) {
    return null;
  }
  return {
    from: source.store,
    goodType: source.goodType,
    units: Math.min(room, source.shortfall),
    refills: source.refills,
    supplies: workplace,
  };
}

/** The recipes `workplace`'s crew runs, each product's own; the carrier's supply view with nobody at work. */
function crewRecipes(
  plan: PlannerContext,
  workplace: Entity,
  seatClaims: WorkSeatClaims,
  supply: Recipe,
): readonly Recipe[] {
  const crew = seatClaims.recipesFor(plan.world, plan.ctx, workplace);
  return crew.length === 0 ? [supply] : crew;
}

/** Whether `recipe` has a cycle's worth of every input in `amountOf`. */
function fundsCycle(recipe: Recipe, amountOf: (goodType: number) => number): boolean {
  return recipe.inputs.every((input) => amountOf(input.goodType) >= input.amount);
}

/**
 * Whether a carrier with inputs aboard goes on to `source` before it brings them home (named addition).
 * It does while no product waits on the cart, that is no recipe of the crew starts only once the load
 * is on the shelf. With one waiting it goes on only to a source no farther off than its workplace's
 * door, a stop on the way home.
 */
function extendsFetchTo(
  plan: PlannerContext,
  workplace: Entity,
  recipes: readonly Recipe[],
  source: MissingInputSource,
): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  const shelf = world.get(workplace, Stockpile).amounts;
  const stocked = (goodType: number): number => shelf.get(goodType) ?? 0;
  const delivered = (goodType: number): number => stocked(goodType) + haulingCartUnits(world, e, goodType);
  const awaited = recipes.some((recipe) => !fundsCycle(recipe, stocked) && fundsCycle(recipe, delivered));
  if (!awaited) return true;
  const door = interactionCell(world, ctx, terrain, workplace, here);
  const sourceCell = interactionCell(world, ctx, terrain, source.store, here);
  return manhattan(terrain, here, sourceCell) <= manhattan(terrain, here, door);
}

/**
 * Whether a carrier with its cart in hand, about to fetch an input from `source`, loads the workshop's
 * finished output first (named addition): the trip out then carries the products and the trip back the
 * inputs, where the two errands apart each run one way empty. Only while the shelf funds a cycle of
 * every product the crew makes, so the operators never wait on the detour, and only from no farther off the workshop's door
 * than the source, so a carrier standing at the store fetches first.
 */
export function loadsOutputBeforeFetch(
  plan: PlannerContext,
  workplace: Entity,
  seatClaims: WorkSeatClaims,
  supply: Recipe,
  source: MissingInputSource,
): boolean {
  const { world, ctx, terrain, entity: e, here } = plan;
  if (!pullsHaulingCart(world, e)) return false;
  const stock = world.get(workplace, Stockpile).amounts;
  const stocked = (goodType: number): number => stock.get(goodType) ?? 0;
  if (!crewRecipes(plan, workplace, seatClaims, supply).every((recipe) => fundsCycle(recipe, stocked))) {
    return false;
  }
  const door = interactionCell(world, ctx, terrain, workplace, here);
  const sourceCell = interactionCell(world, ctx, terrain, source.store, here);
  return manhattan(terrain, here, door) <= manhattan(terrain, here, sourceCell);
}
