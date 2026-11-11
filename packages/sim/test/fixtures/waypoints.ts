import { PathFollow, PathRoute, Position, type Waypoint } from '../../src/components/index.js';
import { type Fixed, fx } from '../../src/core/fixed.js';
import type { Entity, World } from '../../src/ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../src/nav/halfcell.js';
import type { TerrainGraph } from '../../src/nav/terrain/index.js';

/** The node rows a column step spans: straight down one visual row. */
const COLUMN_STEP_ROWS = 2;
/** Samples along a column step at which its position is read. */
const STEP_SAMPLES = 16;

/** A route stop on lattice node `(hx, hy)`, as routing mints one. */
export function stopAt(terrain: TerrainGraph, hx: number, hy: number): Waypoint {
  return { ...positionOfNode(hx, hy), node: terrain.nodeAt(hx, hy) };
}

/**
 * Put positioned `e` on the column step from node `(hx, hy)` down to `(hx, hy + 2)`, at the first sampled
 * point whose position alone reads neither stop. Its node is the step's start while it walks the step,
 * and the node that point reads once the route is dropped. Returns the point.
 */
export function midColumnStep(
  world: World,
  terrain: TerrainGraph,
  e: Entity,
  hx: number,
  hy: number,
): { x: Fixed; y: Fixed } {
  const from = positionOfNode(hx, hy);
  const to = positionOfNode(hx, hy + COLUMN_STEP_ROWS);
  for (let i = 1; i < STEP_SAMPLES; i++) {
    const y = fx.add(from.y, fx.div(fx.mul(fx.sub(to.y, from.y), fx.fromInt(i)), fx.fromInt(STEP_SAMPLES)));
    const read = nodeOfPosition(from.x, y);
    if (read.hx === hx && (read.hy === hy || read.hy === hy + COLUMN_STEP_ROWS)) continue;
    const at = world.mut(e, Position);
    at.x = from.x;
    at.y = y;
    world.add(e, PathRoute, {
      waypoints: [stopAt(terrain, hx, hy), stopAt(terrain, hx, hy + COLUMN_STEP_ROWS)],
    });
    world.add(e, PathFollow, { index: 1, legElapsed: 0, legCost: 0 });
    return { x: from.x, y };
  }
  throw new Error('setup: no point between the column step stops');
}
