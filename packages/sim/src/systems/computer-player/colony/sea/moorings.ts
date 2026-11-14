import { mooringOf, Vehicle, VehicleDrive } from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import type { DeepReadonly, Entity, World } from '../../../../ecs/world.js';
import type { HalfCellNode } from '../../../../nav/halfcell.js';
import { NO_COMPONENT, type TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SeatEnv } from '../env.js';

export function landOf(terrain: TerrainGraph, at: DeepReadonly<HalfCellNode> | null): number {
  return at !== null && terrain.inBounds(at.hx, at.hy)
    ? terrain.componentOf(terrain.nodeAt(at.hx, at.hy))
    : NO_COMPONENT;
}

/** Whether `ship` lies moored on `land`. */
export function mooredOn(env: SeatEnv, ship: Entity, land: number): boolean {
  return land !== NO_COMPONENT && landOf(env.terrain, mooringOf(env.world, ship)) === land;
}

/** Whether `ship` lies still with no drive and no goal held for a boarding: its last order is spent. */
export function lyingStill(world: World, ship: Entity): boolean {
  return !world.has(ship, VehicleDrive) && world.tryGet(ship, Vehicle)?.heldGoal === null;
}

export function dock(ship: Entity, at: DeepReadonly<HalfCellNode>): PlayerCommand {
  return { kind: 'dockVehicle', vehicle: ship, x: at.hx, y: at.hy };
}

/** The ship's riders step ashore where it lies moored. */
export function unloadAt(ship: Entity, at: DeepReadonly<HalfCellNode>): PlayerCommand {
  return { kind: 'unloadPeople', vehicle: ship, mooring: { x: at.hx, y: at.hy } };
}
