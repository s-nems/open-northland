import { defineComponent, type Entity, type World } from '../ecs/world.js';
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

/** A road ordered on one half-cell node and not yet laid. It blocks nothing: settlers walk over it and a
 *  builder stands beside it. Laying it destroys the site, since the road itself lives in
 *  {@link RoadNetwork}. */
export const RoadSite = defineComponent<{
  tribe: number;
  /** The bill resolved from content at placement, like a wall segment's. */
  construction: { goodType: number; amount: number }[];
  /** Exclusive builder claim, taken when a builder picks the site. */
  reservation: null | { builder: Entity };
}>('RoadSite', 'economy');
