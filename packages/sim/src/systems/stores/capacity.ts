import {
  Building,
  DeliveryFlag,
  GroundDrop,
  Palisade,
  Position,
  Stockpile,
  Vehicle,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { exportedGoodForm } from '../readviews/food.js';
import { vehicleMayCarry } from '../readviews/vehicles.js';
import { constructionBillOf } from './construction.js';

/** What a position-less fixture store advertises, so a mapless fixture still accepts deposits. */
const UNCAPPED_CAPACITY = Number.MAX_SAFE_INTEGER;

/**
 * The most units of one good a loose ground heap can hold on one tile. Source basis: extracted - every
 * good-pile `[GfxLandscape]` record declares `LogicMaximumValency 5`, uniform across all 43 good-pile rows
 * in `ir.json`'s `landscapeGfx[].maxValency`, matching the `ls_goods.bmd` art's 5 fill states per good.
 */
export const MAX_GROUND_STACK = 5;

/**
 * The total per-good ceiling of a store's stockpile, not the room left: callers subtract what is on hand.
 * A boat hull applies its whole-hold `stockSlots` total as a per-good bound (approximation: the cap shared
 * across goods is not modelled).
 */
export function stockCapacity(world: World, ctx: SystemContext, store: Entity, goodType: number): number {
  const building = world.tryGet(store, Building);
  if (building !== undefined) {
    const type = contentIndex(ctx.content).buildings.get(building.buildingType);
    if (type === undefined) return 0;
    if (building.built < ONE) {
      // Construction site: the ceiling is that good's line in the bill, cumulative from-scratch or the
      // upgrade difference; any other good is refused.
      for (const line of constructionBillOf(world, ctx, store)) {
        if (line.goodType === goodType) return line.amount;
      }
      return 0;
    }
    return contentIndex(ctx.content).stockSlotCapacityByBuilding.get(type.typeId)?.get(goodType) ?? 0;
  }
  const hull = world.tryGet(store, Vehicle);
  if (hull !== undefined) {
    const type = contentIndex(ctx.content).vehicles.get(hull.vehicleType);
    if (type === undefined) return 0;
    return vehicleMayCarry(type, goodType) ? type.stockSlots : 0;
  }
  const stock = world.tryGet(store, Stockpile);
  if (stock !== undefined && world.has(store, Position)) {
    // Deliberately broader than isYardHeap: the ground clamp applies to every building-less, hull-less
    // pile, including a flag pile or an uncollected trunk that no sink scan would pick.
    const held = lowestStockedGood(stock);
    if (held !== null && held !== goodType) return 0; // a ground heap never mixes goods
    return MAX_GROUND_STACK;
  }
  return UNCAPPED_CAPACITY;
}

/**
 * The slot `store` would shelve a delivered unit of `goodType` in: the good's own where the store type
 * declares one, else its edible form's ({@link exportedGoodForm}), so a larder with no raw dish slot banks
 * the hunter's meat as food. Capacity 0 is a refusal.
 */
export function bankedSlot(
  world: World,
  ctx: SystemContext,
  store: Entity,
  goodType: number,
): { readonly goodType: number; readonly capacity: number } {
  const raw = stockCapacity(world, ctx, store, goodType);
  if (raw > 0) return { goodType, capacity: raw };
  const edible = exportedGoodForm(ctx, goodType);
  if (edible === goodType) return { goodType, capacity: 0 };
  const converted = stockCapacity(world, ctx, store, edible);
  return converted > 0 ? { goodType: edible, capacity: converted } : { goodType, capacity: 0 };
}

/** The lowest-id good a stockpile holds at least one unit of, or null if empty. A min over the map keys,
 *  so the pick stays canonical regardless of insertion order. Walks `keys()` plus `get`: destructured
 *  entries allocate a pair per stock line, and pile and store scans call this per candidate. */
export function lowestStockedGood(stock: { amounts: ReadonlyMap<number, number> }): number | null {
  const { amounts } = stock;
  let lowest: number | null = null;
  for (const goodType of amounts.keys()) {
    if ((amounts.get(goodType) ?? 0) > 0 && (lowest === null || goodType < lowest)) lowest = goodType;
  }
  return lowest;
}

/** Whether `e` is a heap lying on the ground: a positioned stockpile that is neither a building store, a
 *  wall's construction stock nor a boat hull, whatever marker it carries. */
export function isLoosePile(world: World, e: Entity): boolean {
  return (
    world.has(e, Stockpile) &&
    world.has(e, Position) &&
    !world.has(e, Building) &&
    !world.has(e, Palisade) &&
    !world.has(e, Vehicle)
  );
}

/** Whether `e` is a loose gatherer-yard heap: a {@link isLoosePile} that is neither an uncollected trunk
 *  nor a delivery-flag marker. */
export function isYardHeap(world: World, e: Entity): boolean {
  return isLoosePile(world, e) && !world.has(e, GroundDrop) && !world.has(e, DeliveryFlag);
}
