import type { World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { type SeatStock, seatStockOf } from '../../stores/index.js';

/** The seat's stock at home; the seat's own {@link SeatStock} object while it holds no colony. */
export function homeStockOf(world: World, _ctx: SystemContext, seat: number): SeatStock {
  return seatStockOf(world, seat);
}
