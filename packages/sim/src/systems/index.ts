import type { ContentSet } from '@vinland/data';
import { PathFollow, PathRequest, Position, Velocity } from '../components/index.js';
import type { World } from '../ecs/world.js';
import type { EventBuffer } from '../events.js';
import { fx } from '../fixed.js';
import { findPath } from '../pathfinding.js';
import type { Rng } from '../rng.js';
import type { CellId, TerrainGraph } from '../terrain.js';

/**
 * A System is a pure function over the world for one tick. Systems run in a fixed registered
 * order (see SYSTEM_ORDER below and docs/ECS.md). They may read/write components and use ctx.rng,
 * but must not touch wall-clock, Math.random, the DOM, or I/O.
 */
export interface SystemContext {
  readonly content: ContentSet;
  readonly rng: Rng;
  /** Monotonic tick counter. */
  readonly tick: number;
  /** Emit one-shot events for render/audio (never read back in sim logic). */
  readonly events: EventBuffer;
  /**
   * The terrain cell-adjacency graph — the navigation/placement model (see terrain.ts). Optional
   * because trivial fixtures (the determinism golden) run with no map; the pathfinding/terrain
   * systems that need it must check and no-op when it is absent rather than assume it exists.
   */
  readonly terrain?: TerrainGraph;
}

export type System = (world: World, ctx: SystemContext) => void;

/**
 * MovementSystem — the one real system in the slice: advance positions by velocity.
 * Fixed-point only. Demonstrates the query + deterministic iteration pattern.
 */
export const movementSystem: System = (world) => {
  for (const e of world.query(Position, Velocity)) {
    const p = world.get(e, Position);
    const v = world.get(e, Velocity);
    p.x = fx.add(p.x, v.x);
    p.y = fx.add(p.y, v.y);
  }
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

function inRange(terrain: TerrainGraph, cell: number): boolean {
  return Number.isInteger(cell) && cell >= 0 && cell < terrain.cellCount;
}

/* ----------------------------------------------------------------------------------------------
 * The remaining systems are stubs to be implemented per docs/ROADMAP.md. They are listed here so
 * the execution order and intent are explicit and version-controlled. Each maps onto original
 * content types (goodtypes/jobtypes/housetypes/weapontypes/animaltypes/vehicletypes/tribetypes).
 * -------------------------------------------------------------------------------------------- */
const todo =
  (name: string): System =>
  () => {
    /* not yet implemented — see docs/ROADMAP.md */
    void name;
  };

export const commandSystem: System = todo('CommandSystem'); // apply queued serializable player commands
export const timeSystem: System = todo('TimeSystem'); // advance clock / day / season
export const terrainSystem: System = todo('TerrainSystem'); // resource regrowth, fertility (cell graph)
export const needsSystem: System = todo('NeedsSystem'); // hunger/health + the food/goods chain
export const progressionSystem: System = todo('ProgressionSystem'); // experience + tech graph (needfor*/allow*/jobEnables*) gates jobs/goods/houses/vehicles
export const aiSystem: System = todo('AISystem'); // planner: pick the next ATOMIC for each idle settler (utility over allowed atomics)
export const atomicSystem: System = todo('AtomicSystem'); // advance the CurrentAtomic; on completion apply its effect + notify planner
export const jobSystem: System = todo('JobSystem'); // match idle settlers to open jobs/workplaces
// pathfindingSystem is a REAL system now (above) — A* on the cell graph, budgeted/tick.
export const productionSystem: System = todo('ProductionSystem'); // recipes (goodtypes.productionInputGoods): inputs -> outputs, enforce stock capacity
export const transportSystem: System = todo('TransportSystem'); // carriers physically haul goods between stores (no global bank)
export const constructionSystem: System = todo('ConstructionSystem'); // deliver materials, advance build, level houses
export const combatSystem: System = todo('CombatSystem'); // N-tribe combat from weapontypes/armortypes (large subsystem)
export const reproductionSystem: System = todo('ReproductionSystem'); // families/children, gated by house level capacity
export const cleanupSystem: System = todo('CleanupSystem'); // destroy dead entities (ids are NOT recycled), emit events for render/audio

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
