import {
  MoveGoal,
  PathFollow,
  PathRequest,
  Position,
  Stranded,
  UnreachableGoals,
} from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';

/** A script changes topology immediately; existing paths and remembered failures must not outlive it. */
export function invalidateLandscapeRoutes(world: World, terrain: TerrainGraph): void {
  forgetRouteFailures(world);
  // A diagonal can close through its midpoint flanks without either endpoint becoming blocked.
  // Requeue active routes through the normal search budget, including travellers already mid-leg.
  for (const e of [...world.query(PathFollow, Position)]) {
    const goal = world.tryGet(e, MoveGoal)?.cell;
    world.remove(e, PathFollow);
    world.remove(e, PathRequest);
    if (goal !== undefined) {
      const p = world.get(e, Position);
      const start = nodeOfPosition(p.x, p.y);
      world.add(e, PathRequest, { start: terrain.nodeAtClamped(start.hx, start.hy), goal, failed: false });
    }
  }
}

/** Drop every remembered unreachable goal and stranded park, so a way a script opened is tried again
 *  at once rather than when the memo runs out. */
export function forgetRouteFailures(world: World): void {
  for (const e of [...world.query(Stranded)]) world.remove(e, Stranded);
  for (const e of [...world.query(UnreachableGoals)]) world.remove(e, UnreachableGoals);
}
