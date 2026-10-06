import type { Waypoint } from '../../components/index.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';

export interface NodeBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** Each route's node bounds, which also hold its diagonals' midpoint flanks, for the closing test that
 *  stops walkers short of a new wall (`landscape/routes.ts`). Keyed on the stop array, which a delivery or
 *  a cut replaces rather than edits. Routing reads a route's bounds as it installs it, while its stops are
 *  fresh in memory, so a closing tests the routes in view without walking each again. Derived, never
 *  hashed. */
const routeBounds = new WeakMap<readonly Waypoint[], NodeBounds>();

export function routeBoundsOf(terrain: TerrainGraph, waypoints: readonly Waypoint[]): NodeBounds {
  let bounds = routeBounds.get(waypoints);
  if (bounds === undefined) {
    bounds = emptyBounds();
    for (let i = 0; i < waypoints.length; i++) {
      const stop = waypoints[i];
      if (stop !== undefined) extendBounds(terrain, bounds, stop.node);
    }
    routeBounds.set(waypoints, bounds);
  }
  return bounds;
}

export function nodeBoundsOf(terrain: TerrainGraph, nodes: Iterable<NodeId>): NodeBounds {
  const bounds = emptyBounds();
  for (const node of nodes) extendBounds(terrain, bounds, node);
  return bounds;
}

function emptyBounds(): MutableBounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
}

function extendBounds(terrain: TerrainGraph, bounds: MutableBounds, node: NodeId): void {
  const x = terrain.xOf(node);
  const y = terrain.yOf(node);
  if (x < bounds.minX) bounds.minX = x;
  if (x > bounds.maxX) bounds.maxX = x;
  if (y < bounds.minY) bounds.minY = y;
  if (y > bounds.maxY) bounds.maxY = y;
}

type MutableBounds = { -readonly [K in keyof NodeBounds]: NodeBounds[K] };
