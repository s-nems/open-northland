import { HaulingCart, Position, Vehicle, vehiclePassengers } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { hexDistance } from '../../../nav/halfcell.js';
import { homeSettlers } from '../../ai-shared/home-roster.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../context.js';
import { vehicleAnchor } from '../../footprint/index.js';
import { isCartType } from '../../vehicles/drag.js';
import { canTakeHaulingCart, isPostedCarrier } from '../../vehicles/hauling-cart.js';
import { vehicleIndex } from '../../vehicles/registry.js';

/** Whether `vehicle` stands on the map with nobody pulling, carrying, crewing or riding it. */
export function standsFree(world: World, vehicle: Entity): boolean {
  const state = world.get(vehicle, Vehicle);
  return (
    state.hauler === null &&
    state.carrier === null &&
    vehiclePassengers(state).length === 0 &&
    world.has(vehicle, Position)
  );
}

/**
 * Hand each of the seat's free carts, ascending, to the nearest posted carrier who pulls none, the lowest
 * id on a tie (authored). The attach claims the cart when it applies (`Vehicle.hauler`), before the next
 * decision reads it again.
 */
export function assignHaulingCarts(world: World, ctx: SystemContext, player: number): PlayerCommand[] {
  const vehicles = contentIndex(ctx.content).vehicles;
  const carts = vehicleIndex(world)
    .ownedBy(player)
    .filter((e) => {
      const type = vehicles.get(world.get(e, Vehicle).vehicleType);
      return type !== undefined && isCartType(type) && standsFree(world, e);
    });
  if (carts.length === 0) return [];
  const cartless = homeSettlers(world, ctx, player).filter(
    (e) => !world.has(e, HaulingCart) && isPostedCarrier(world, ctx.content, e),
  );
  const commands: PlayerCommand[] = [];
  const drafted = new Set<Entity>();
  for (const vehicle of carts) {
    const at = vehicleAnchor(world, vehicle);
    if (at === null) continue;
    let best: { readonly e: Entity; readonly distance: number } | null = null;
    for (const e of cartless) {
      if (drafted.has(e) || !canTakeHaulingCart(world, ctx, e, vehicle)) continue;
      const node = anchorNodeOf(world, e);
      if (node === null) continue;
      const distance = hexDistance(node, at);
      if (best === null || distance < best.distance) best = { e, distance };
    }
    if (best === null) continue;
    drafted.add(best.e);
    commands.push({ kind: 'attachToVehicle', entity: best.e, vehicle });
  }
  return commands;
}
