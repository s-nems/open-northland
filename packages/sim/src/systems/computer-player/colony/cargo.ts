import { Vehicle, VehicleStock, vehicleLoad } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import type { SystemContext } from '../../context.js';
import type { SeatStock } from '../../stores/index.js';
import { COLONY_STORE_BUILDING_ID } from './survey.js';

/** What a colony sails with, by content id, in the order the hold takes it (authored from the founding bill
 *  of a store and four homes, about twice over). Wood comes last: hands fetch line by line, so a load cut
 *  short lacks what the bill wants most of, not a whole good, and a 50-unit hold cuts it to 22, past the
 *  12 that bill wants. */
const MANIFEST: readonly { readonly id: string; readonly amount: number }[] = [
  { id: 'stone', amount: 7 },
  { id: 'mud', amount: 9 },
  { id: 'wheat', amount: 12 },
  { id: 'wood', amount: 23 },
];

interface CargoLine {
  readonly goodType: number;
  readonly amount: number;
}

/** The manifest's lines the content knows. */
export function colonyManifest(ctx: SystemContext): CargoLine[] {
  return MANIFEST.flatMap(({ id, amount }) => {
    const good = goodTypeByContentId(ctx.content, id);
    return good === undefined ? [] : [{ goodType: good.typeId, amount }];
  });
}

/** Whether `stock` holds what the manifest still wants beyond what lies aboard `ship`. */
export function manifestInStock(world: World, ctx: SystemContext, stock: SeatStock, ship: Entity): boolean {
  const hold = world.tryGet(ship, VehicleStock)?.lines;
  return colonyManifest(ctx).every(
    (line) => stock.units(line.goodType) >= line.amount - (hold?.get(line.goodType)?.current ?? 0),
  );
}

/** One order per line of the manifest: the riders of `ship` fetch them. */
export function wantManifest(ctx: SystemContext, ship: Entity): PlayerCommand[] {
  return colonyManifest(ctx).map((line) => ({
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

/** Whether no line of `ship`'s hold lies aboard past what is asked of it. */
export function holdFlushed(world: World, ship: Entity): boolean {
  const stock = world.tryGet(ship, VehicleStock);
  if (stock === undefined) return true;
  for (const line of stock.lines.values()) if (line.current > line.wanted) return false;
  return true;
}

/** Whether `ship` holds what a warehouse costs: without that a colony cannot start. */
export function holdsStoreBill(world: World, ctx: SystemContext, ship: Entity): boolean {
  const index = contentIndex(ctx.content);
  const store = index.buildingTypeBySlug.get(COLONY_STORE_BUILDING_ID);
  const bill = store === undefined ? undefined : index.constructionBillByBuilding.get(store);
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
