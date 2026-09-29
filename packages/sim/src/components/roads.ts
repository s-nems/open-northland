import type { World } from '../ecs/world.js';
import { defineWorldSingleton } from '../ecs/world-singleton.js';
import type { NodeId } from '../nav/terrain/index.js';

export interface RoadNetworkState {
  /** The half-cell nodes a road runs over, in laying order: a set, kept as a Map because the save
   *  encodes Maps. */
  nodes: Map<NodeId, boolean>;
  /** Bumped by every change to {@link nodes}, so a mirror redraws or re-syncs only on a change. */
  revision: number;
}

const network = defineWorldSingleton<RoadNetworkState>('RoadNetwork', 'movement', () => ({
  nodes: new Map(),
  revision: 0,
}));
export const RoadNetwork = network.component;
export const roadNetworkState = (world: World) => network.read(world);
export function writeRoadNetwork(world: World, apply: (state: RoadNetworkState) => void): void {
  network.write(world, apply);
}
