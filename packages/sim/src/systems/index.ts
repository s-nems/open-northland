import { PathFollow, PathRequest } from '../components/index.js';
import { fx } from '../fixed.js';
import { findPath } from '../pathfinding.js';
import type { CellId, TerrainGraph } from '../terrain.js';
import { aiSystem } from './ai.js';
import { atomicSystem } from './atomic.js';
import { commandSystem } from './command.js';
import type { System, SystemContext } from './context.js';
import { MOVE_SPEED_PER_TICK, movementSystem } from './movement.js';
import { productionSystem } from './production.js';
import { inRange } from './shared.js';
import {
  cleanupSystem,
  combatSystem,
  constructionSystem,
  jobSystem,
  needsSystem,
  progressionSystem,
  reproductionSystem,
  terrainSystem,
  timeSystem,
  transportSystem,
} from './stubs.js';

// Every real system now lives in its own module under systems/ — commandSystem (./command.ts),
// movementSystem (./movement.ts), productionSystem (./production.ts), atomicSystem (./atomic.ts),
// aiSystem (./ai.ts, the settler planner) — and the not-yet-implemented stubs (./stubs.ts). The
// barrel re-exports them so `@vinland/sim`'s `systems` namespace (and the tests) keep a single
// import site. The genuinely cross-system helpers live in ./shared.ts. The only system still
// defined here is pathfindingSystem (it reuses the A* core from ../pathfinding.ts and `inRange`
// from the shared leaf). This is the systems/ split — see docs/TECH-DEBT.md.
export type { System, SystemContext };
export { aiSystem };
export { commandSystem };
export { MOVE_SPEED_PER_TICK, movementSystem };
export { productionSystem };
export { atomicSystem };
export {
  cleanupSystem,
  combatSystem,
  constructionSystem,
  jobSystem,
  needsSystem,
  progressionSystem,
  reproductionSystem,
  terrainSystem,
  timeSystem,
  transportSystem,
};

/**
 * The maximum number of {@link PathRequest}s the pathfinder will resolve in a single tick. A*
 * is the heaviest per-call work in the schedule, so spreading many requests over several ticks
 * keeps the tick cost bounded — the budget is the determinism-safe spread (we always serve the
 * lowest entity ids first, never a wall-clock cutoff). Tune as crowds grow; one is plenty for
 * the single-settler slice.
 */
export const PATHFINDING_BUDGET_PER_TICK = 8;

/**
 * PathfindingSystem — drains pending {@link PathRequest}s and turns each into a followable path.
 *
 * For up to {@link PATHFINDING_BUDGET_PER_TICK} requests per tick (lowest entity ids first, so the
 * spread is history-independent), it runs A* on `ctx.terrain` from the request's `start` to `goal`
 * cell. On success it writes the cell sequence into the entity's {@link PathFollow} (cell centres,
 * in fixed-point tile units) and removes the request; on failure it flags the request `failed` and
 * removes any stale path, leaving the request for the planner to inspect rather than silently
 * retrying the same dead query every tick. No-ops entirely when no terrain graph is present — a
 * mapless sim (the determinism golden) has nothing to route over.
 *
 * Determinism: A* is pure and canonically tie-broken; requests are served in ascending entity-id
 * order (a canonical sort, not Map insertion order); cell ids are validated against the graph so an
 * out-of-range request fails gracefully instead of throwing inside the search.
 */
export const pathfindingSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: nothing to route over

  // Serve in ascending entity-id order so the per-tick budget cut is canonical (never insertion
  // order). canonicalEntities() is the sorted id list; filter to those with a live request.
  let served = 0;
  for (const e of world.canonicalEntities()) {
    if (served >= PATHFINDING_BUDGET_PER_TICK) break;
    const req = world.tryGet(e, PathRequest);
    if (req === undefined || req.failed) continue; // already-failed requests aren't retried
    served++;

    const path = resolvePath(terrain, req.start, req.goal);
    if (path === null) {
      req.failed = true; // signal the planner; keep the request so it isn't silently re-issued
      world.remove(e, PathFollow); // drop any stale path so movement doesn't follow a dead route
      continue;
    }

    // Success: hand the entity a fresh PathFollow of cell-centre waypoints and clear the request.
    const waypoints = path.map((cell) => {
      const { x, y } = terrain.coordsOf(cell);
      return { x: fx.fromInt(x), y: fx.fromInt(y) };
    });
    world.add(e, PathFollow, { waypoints, index: 0 });
    world.remove(e, PathRequest);
  }
};

/**
 * Run A* for a request, guarding the raw cell ids against the graph bounds first. An id outside
 * `0..cellCount-1` is a bad request (e.g. a goal off a smaller map) — treat it as "no route"
 * (null) rather than letting it throw inside the heuristic, since a request is boundary input.
 */
function resolvePath(terrain: TerrainGraph, start: number, goal: number): CellId[] | null {
  if (!inRange(terrain, start) || !inRange(terrain, goal)) return null;
  return findPath(terrain, start as CellId, goal as CellId);
}

/**
 * The canonical per-tick execution order. Order is part of the design — change deliberately.
 * Note the AI->Atomic split: AISystem chooses an atomic, AtomicSystem executes it to completion.
 * Most "behavior" lives in these two + the data-driven atomic vocabulary, not in bespoke systems.
 */
export const SYSTEM_ORDER: readonly System[] = [
  commandSystem,
  timeSystem,
  terrainSystem,
  needsSystem,
  progressionSystem,
  aiSystem,
  jobSystem,
  pathfindingSystem,
  movementSystem,
  atomicSystem,
  productionSystem,
  transportSystem,
  constructionSystem,
  combatSystem,
  reproductionSystem,
  cleanupSystem,
];
