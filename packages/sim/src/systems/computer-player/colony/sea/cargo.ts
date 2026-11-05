import {
  Stockpile,
  UnderConstruction,
  Vehicle,
  VehicleStock,
  vehicleLoad,
} from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { homeBuildings } from '../../../ai-shared/home-roster.js';
import type { SystemContext } from '../../../context.js';
import { edibleClassOf } from '../../../readviews/food.js';
import { mayFetchGoodFrom } from '../../../stores/workplace.js';
import { FOOD_COMFORT_UNITS_PER_SETTLER } from '../../workforce/food.js';
import { foodGood } from '../home-supply.js';
import { homeStockOf } from '../stock.js';
import { colonyStoreType } from '../store-type.js';

/** Food per member of the founding party (authored: the comfort line home keeps a mouth), what it eats
 *  until its fishers and the trader feed it. */
const FOUNDING_FOOD_PER_COLONIST = FOOD_COMFORT_UNITS_PER_SETTLER;

interface CargoLine {
  readonly goodType: number;
  readonly amount: number;
}

/** The whole bill of the colony's first store, placed at that tier, one line per good. */
export function storeBill(world: World, ctx: SystemContext, seat: number): CargoLine[] {
  return [...storeBillByGood(world, ctx, seat)].map(([goodType, amount]) => ({ goodType, amount }));
}

function storeBillByGood(world: World, ctx: SystemContext, seat: number): Map<number, number> {
  const store = colonyStoreType(world, ctx, seat);
  const bill =
    store === undefined ? [] : (contentIndex(ctx.content).constructionBillByBuilding.get(store.typeId) ?? []);
  const lines = new Map<number, number>();
  for (const line of bill) lines.set(line.goodType, (lines.get(line.goodType) ?? 0) + line.amount);
  return lines;
}

/** What a colony's hold is asked to take: the {@link storeBill} and food for its `party`. */
export function colonyManifest(world: World, ctx: SystemContext, seat: number, party: number): CargoLine[] {
  const lines = storeBillByGood(world, ctx, seat);
  const food = foodGood(ctx);
  if (food !== null) lines.set(food, (lines.get(food) ?? 0) + FOUNDING_FOOD_PER_COLONIST * party);
  return [...lines].map(([goodType, amount]) => ({ goodType, amount }));
}

/** The units of each good at home a hold's hands may fetch: home's stock less what its sites and upgrades
 *  hold for their bills, its workshops for their recipes and its homes as food, which nobody hands a ship.
 *  Warehouses, workshop output and the heaps on home's ground stay in, and a food line's dishes. */
export function homeStockToLoad(
  world: World,
  ctx: SystemContext,
  seat: number,
): (goodType: number) => number {
  const stock = homeStockOf(world, ctx, seat);
  const home = homeBuildings(world, ctx, seat);
  const units = (goodType: number): number => {
    let kept = 0;
    for (const e of home) {
      const pile = world.tryGet(e, Stockpile)?.amounts.get(goodType) ?? 0;
      if (pile > 0 && (world.has(e, UnderConstruction) || !mayFetchGoodFrom(world, ctx, e, goodType)))
        kept += pile;
    }
    return stock.units(goodType) - kept;
  };
  // A food line takes the dishes that become it too, as the hold's hands fetch them.
  return (goodType) => {
    const forms = edibleClassOf(ctx.content, goodType);
    return forms.length === 0 ? units(goodType) : forms.reduce((sum, form) => sum + units(form), 0);
  };
}

/** Whether home holds (`held`, {@link homeStockToLoad}) what the manifest still wants beyond what lies
 *  aboard `ship`.
 *  What home's sites still lack is not set against it, so the homes lift, which keeps sites open, never
 *  holds the party. */
export function manifestInStock(
  world: World,
  held: (goodType: number) => number,
  ship: Entity,
  manifest: readonly CargoLine[],
): boolean {
  const hold = world.tryGet(ship, VehicleStock)?.lines;
  return manifest.every(
    (line) => held(line.goodType) >= line.amount - (hold?.get(line.goodType)?.current ?? 0),
  );
}

/** One order per line of `manifest`: the riders of `ship` fetch them. */
export function wantManifest(ship: Entity, manifest: readonly CargoLine[]): PlayerCommand[] {
  return manifest.map((line) => ({
    kind: 'setVehicleWanted',
    vehicle: ship,
    goodType: line.goodType,
    amount: line.amount,
  }));
}

/** Whether every line asked of `ship`'s hold lies aboard. */
export function holdDone(world: World, ship: Entity): boolean {
  const stock = world.tryGet(ship, VehicleStock);
  if (stock === undefined) return false;
  for (const line of stock.lines.values()) if (line.current < line.wanted) return false;
  return vehicleLoad(stock) > 0;
}

/** Whether `ship` holds what the colony's first store costs: without that a colony cannot start. */
export function holdsStoreBill(world: World, ctx: SystemContext, seat: number, ship: Entity): boolean {
  const store = colonyStoreType(world, ctx, seat);
  const bill =
    store === undefined ? undefined : contentIndex(ctx.content).constructionBillByBuilding.get(store.typeId);
  const stock = world.tryGet(ship, VehicleStock);
  if (bill === undefined || stock === undefined) return false;
  return bill.every((line) => (stock.lines.get(line.goodType)?.current ?? 0) >= line.amount);
}

/** Orders fixing each line's wanted amount at what lies aboard, so nobody fetches or flushes at sea's end. */
export function pinHold(world: World, ship: Entity): PlayerCommand[] {
  const stock = world.tryGet(ship, VehicleStock);
  if (stock === undefined) return [];
  const commands: PlayerCommand[] = [];
  for (const [goodType, line] of stock.lines) {
    if (line.wanted !== line.current)
      commands.push({ kind: 'setVehicleWanted', vehicle: ship, goodType, amount: line.current });
  }
  return commands;
}

/** Units aboard `ship`, 0 for one gone. */
export function holdLoad(world: World, ship: Entity): number {
  const stock = world.has(ship, Vehicle) ? world.tryGet(ship, VehicleStock) : undefined;
  return stock === undefined ? 0 : vehicleLoad(stock);
}
