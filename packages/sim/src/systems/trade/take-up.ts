import { Rider, TRADE_ROUTE_HOUSES, TradeRoute, Vehicle } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { System } from '../context.js';
import { commandedVehicleOf } from '../vehicles/commander.js';
import { detachBeforeOrder } from '../vehicles/crew.js';
import { isCartType } from '../vehicles/drag.js';
import { canTakeHaulingCart, orderAttachToVehicle } from '../vehicles/hauling-cart.js';

/**
 * A trader with a full route that commands a standing cart, seated by a script's captain or crew attach
 * or by an attach a hauling cart could not answer, steps out and takes that cart up as its hauling cart,
 * the tool its route runs on (owner's choice: the original's trader works the route from the cart). One
 * with a shorter route keeps its seat, and a ship or a catapult keeps its trader. Before the planner, so
 * the trader is planned the tick it steps out.
 */
export const traderTakesUpCartSystem: System = (world, ctx) => {
  for (const e of world.canonicalQuery(Rider, TradeRoute)) {
    if (world.get(e, TradeRoute).stops.length < TRADE_ROUTE_HOUSES) continue;
    const vehicle = commandedVehicleOf(world, e);
    if (vehicle === null) continue;
    const type = contentIndex(ctx.content).vehicles.get(world.get(vehicle, Vehicle).vehicleType);
    if (type === undefined || !isCartType(type)) continue;
    if (!detachBeforeOrder(world, ctx, e)) continue;
    // A cart that refuses the trader as its puller is left standing, and the trader works on foot.
    if (canTakeHaulingCart(world, ctx, e, vehicle)) {
      orderAttachToVehicle(world, ctx, { kind: 'attachToVehicle', entity: e, vehicle });
    }
  }
};
