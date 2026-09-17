import { cellAnchorNode, components, type Entity, type Simulation, systems } from '@open-northland/sim';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../rules.js';

const { Vehicle } = components;

type VehicleSpawnContext = Parameters<typeof systems.createVehicle>[1];

/** The system context a pre-tick placement hands the vehicle spawn: the sim's own resources, as
 *  `step()` assembles them for a system. */
function spawnContext(sim: Simulation): VehicleSpawnContext {
  return {
    content: sim.content,
    rng: sim.rng,
    tick: sim.tick,
    events: sim.events,
    commands: sim.commands,
    ...(sim.terrain !== undefined ? { terrain: sim.terrain } : {}),
  };
}

/**
 * Stand a vehicle of `vehicleType` at cell (x, y) directly (scene setup, pre-tick-0) and return it, so a
 * scene can load its hold or turn it. Throws for a type the content lacks.
 */
export function spawnVehicleDirect(
  sim: Simulation,
  vehicleType: number,
  x: number,
  y: number,
  opts: { readonly tribe?: number; readonly owner?: number; readonly facing?: number } = {},
): Entity {
  const node = cellAnchorNode(x, y);
  const e = systems.createVehicle(sim.world, spawnContext(sim), {
    vehicleType,
    x: node.hx,
    y: node.hy,
    tribe: opts.tribe ?? PRIMARY_TRIBE,
    owner: opts.owner ?? HUMAN_PLAYER,
  });
  if (e === null) throw new Error(`spawnVehicleDirect: unknown vehicle type ${vehicleType}`);
  if (opts.facing !== undefined) sim.world.mut(e, Vehicle).facing = opts.facing;
  return e;
}
