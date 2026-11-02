import type { World } from '../../../ecs/world.js';
import { everyBuildingOf, homeBuildings } from '../../ai-shared/home-roster.js';
import type { SystemContext } from '../../context.js';
import { type SeatStock, seatStockOf, stockAtBuildings } from '../../stores/index.js';

interface HomeStock {
  readonly tick: number;
  readonly whole: SeatStock;
  readonly home: SeatStock;
}

const homeStocks = new WeakMap<World, Map<number, HomeStock>>();

/** The stock of a seat with `away` units held by its colony: the seat's own figure less those. */
function stockLess(whole: SeatStock, away: ReadonlyMap<number, number>): SeatStock {
  const units = (goodType: number): number => whole.units(goodType) - (away.get(goodType) ?? 0);
  return { units, exceeds: (goodType, amount) => units(goodType) > amount };
}

/**
 * The seat's stock at home: its {@link SeatStock} less what its colony's buildings hold and the ground
 * heaps they reach. The seat's own object while no colony building stands. Approximation: a heap only a
 * colony signpost reaches stays in the figure. Derived once per tick, never hashed.
 */
export function homeStockOf(world: World, ctx: SystemContext, seat: number): SeatStock {
  const whole = seatStockOf(world, seat);
  const every = everyBuildingOf(world, seat);
  const home = homeBuildings(world, ctx, seat);
  if (home.length === every.length) return whole;
  let bySeat = homeStocks.get(world);
  if (bySeat === undefined) {
    bySeat = new Map();
    homeStocks.set(world, bySeat);
  }
  const held = bySeat.get(seat);
  if (held !== undefined && held.tick === ctx.tick && held.whole === whole) return held.home;
  const stays = new Set(home);
  const away = stockAtBuildings(
    world,
    seat,
    every.filter((e) => !stays.has(e)),
  );
  const stock = stockLess(whole, away);
  bySeat.set(seat, { tick: ctx.tick, whole, home: stock });
  return stock;
}
