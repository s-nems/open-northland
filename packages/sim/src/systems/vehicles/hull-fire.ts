import { Health, Position, Vehicle } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { System } from '../context.js';
import { isShipVehicle } from '../readviews/index.js';

// Hull fire, a named addition (owner rule): a ship beaten below a share of its hull catches fire and burns
// down slowly on its own, so a crippled ship cannot sit out a fight forever.

/** The hull share, in percent, under which a ship burns. The renderer lights its flames at the same
 *  share. Owner rule. */
export const SHIP_FIRE_HEALTH_PERCENT = 40;

/** Hitpoints a burning hull loses each second: a 10000-point ship left alone goes down a little over three
 *  minutes after it catches. Owner rule: slowly. */
export const SHIP_FIRE_DAMAGE_PER_SECOND = 20;

const PERCENT = 100;

/** Burn every ship under {@link SHIP_FIRE_HEALTH_PERCENT}, once a second; cleanup sinks the ones it ends. */
export const hullFireSystem: System = (world, ctx) => {
  if (ctx.tick % TICKS_PER_SECOND !== 0) return;
  const vehicles = contentIndex(ctx.content).vehicles;
  for (const e of world.canonicalQuery(Vehicle, Health, Position)) {
    const type = vehicles.get(world.get(e, Vehicle).vehicleType);
    if (type === undefined || !isShipVehicle(type)) continue;
    const health = world.get(e, Health);
    if (health.hitpoints <= 0 || health.hitpoints * PERCENT >= health.max * SHIP_FIRE_HEALTH_PERCENT)
      continue;
    world.mut(e, Health).hitpoints = Math.max(0, health.hitpoints - SHIP_FIRE_DAMAGE_PER_SECOND);
  }
};
