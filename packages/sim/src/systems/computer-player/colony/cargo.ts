import { Vehicle, VehicleStock, vehicleLoad } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import type { SeatStock } from '../../stores/index.js';
import { FOOD_COMFORT_UNITS_PER_SETTLER } from '../workforce/food.js';
import { foodGood } from './home-supply.js';
import { colonyStoreType } from './store-tier.js';

/** Food per member of the founding party (authored: the comfort line home keeps a mouth), what it eats
 *  until its fishers and the trader feed it. */
const FOUNDING_FOOD_PER_COLONIST = FOOD_COMFORT_UNITS_PER_SETTLER;

interface CargoLine {
  readonly goodType: number;
  readonly amount: number;
}

/** What a colony sails with: the whole bill of its first store, placed at that tier, and food for its
 *  `party`. */
export function colonyManifest(world: World, ctx: SystemContext, seat: number, party: number): CargoLine[] {
  const store = colonyStoreType(world, ctx, seat);
  const bill =
    store === undefined ? [] : (contentIndex(ctx.content).constructionBillByBuilding.get(store.typeId) ?? []);
  const lines = new Map<number, number>();
  for (const line of bill) lines.set(line.goodType, (lines.get(line.goodType) ?? 0) + line.amount);
  const food = foodGood(ctx);
  if (food !== null) lines.set(food, (lines.get(food) ?? 0) + FOUNDING_FOOD_PER_COLONIST * party);
  return [...lines].map(([goodType, amount]) => ({ goodType, amount }));
}

/** Whether `stock`, less what home's sites hold or still lack (`claimed`), holds what the manifest still
 *  wants beyond what lies aboard `ship`: seat stock counts a site's hold, which only the site spends. */
export function manifestInStock(
  world: World,
  stock: SeatStock,
  claimed: ReadonlyMap<number, number>,
  ship: Entity,
  manifest: readonly CargoLine[],
): boolean {
  const hold = world.tryGet(ship, VehicleStock)?.lines;
  return manifest.every(
    (line) =>
      stock.units(line.goodType) - (claimed.get(line.goodType) ?? 0) >=
      line.amount - (hold?.get(line.goodType)?.current ?? 0),
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
