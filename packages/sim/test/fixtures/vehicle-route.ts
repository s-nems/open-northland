import { VehicleDrive, VehicleRoute } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import type { HalfCellNode, Simulation } from '../../src/index.js';

/** The nodes a vehicle's drive still has to enter, the next first; empty without a drive. */
export function routeAhead(s: Simulation, vehicle: Entity): readonly HalfCellNode[] {
  const drive = s.world.tryGet(vehicle, VehicleDrive);
  const nodes = s.world.tryGet(vehicle, VehicleRoute)?.nodes ?? [];
  return drive === undefined ? [] : nodes.slice(drive.step);
}
