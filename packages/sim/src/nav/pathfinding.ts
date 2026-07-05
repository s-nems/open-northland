/**
 * A* pathfinding over the terrain CELL-ADJACENCY GRAPH (docs/ROADMAP.md, Phase 2).
 *
 * This is the pure search the PathfindingSystem drives. It walks {@link TerrainGraph.steps} (the
 * canonical 6-connected staggered-lattice edge set: E,W then NE,SE,SW,NW), using
 * {@link cellLatticeDistance} as the admissible heuristic and each step's own cost (its real world
 * length: column ONE, row-crossing ≈ ¾) as the edge cost. The result is the lowest-cost cell
 * sequence from `start` to `goal`, inclusive of both, or `null` when no walkable route exists —
 * minimising TRUE on-screen distance, so a route reads straight under the staggered raster.
 *
 * DETERMINISM: every tie is broken by a fixed, history-independent rule so two runs (or two clients in
 * lockstep) pick byte-identical paths. The open set is a flat array scanned for the canonical minimum —
 * never a Map/Set whose iteration order is insertion-history-dependent. The minimum is chosen by
 * (lowest f, then lowest h, then lowest deviation from the start→goal line, then lowest cell id);
 * neighbours are expanded in the graph's canonical order. The LINE-DEVIATION key only ever separates
 * routes that already tie on cost, so optimality is untouched — its job is visual: the staggered
 * lattice offers many equal-cost weaves to the same cell (e.g. straight down the screen), and without
 * it the id tie-break picks one that drifts a full column sideways before correcting (the reported
 * "walks off to the side"); with it the route hugs the straight screen line a player expects. It is a
 * pure function of (cell, start, goal) world coordinates — no history, so lockstep-safe. No floats
 * touch the search: all costs are {@link Fixed}. `start`/`goal` must be walkable — an unwalkable
 * endpoint yields `null` (no route), not a throw, since it is a recoverable query.
 */
import { type Fixed, fx } from '../core/fixed.js';
import { ROW_STEP, worldX } from './metric.js';
import { type CellId, type TerrainGraph, cellLatticeDistance } from './terrain.js';

/** A* per-cell bookkeeping. `g` = best known cost from start; `f` = g + heuristic; `h` = heuristic. */
interface CellRecord {
  readonly cell: CellId;
  g: Fixed;
  f: Fixed;
  h: Fixed;
  /** The cell's world-space deviation from the start→goal line (the visual-straightness tie-break) —
   *  a pure function of the cell + endpoints, computed once at discovery, never path-dependent. */
  readonly dev: Fixed;
  /** Predecessor cell on the best known path, or null for the start cell. */
  cameFrom: CellId | null;
  /** False once popped from the open set (closed) — a settled cell is never re-expanded. */
  open: boolean;
}

/**
 * Find the lowest-cost walkable path from `start` to `goal` on the cell graph, inclusive of both
 * endpoints. Returns `null` when no route exists or either endpoint is unwalkable. `start === goal`
 * yields the single-cell path `[start]` (when walkable).
 *
 * `blocked` is the DYNAMIC walk-block overlay (cells standing buildings occupy —
 * `buildingBlockedCells`), applied on top of the graph's static terrain walkability: a blocked cell
 * is never entered (goal included), but a blocked START is deliberately exempt — an entity standing
 * where a foundation just appeared must be able to step OFF the footprint (its first move leaves the
 * blocked cell; it can never move back in).
 */
export function findPath(
  graph: TerrainGraph,
  start: CellId,
  goal: CellId,
  blocked?: ReadonlySet<CellId>,
): CellId[] | null {
  if (!graph.isWalkable(start) || !graph.isWalkable(goal)) return null;
  // Already-there wins over the overlay: consistent with the blocked-START exemption, an entity
  // standing on its own (even occupied) goal cell trivially succeeds rather than reading "unreachable".
  if (start === goal) return [start];
  if (blocked?.has(goal)) return null; // an occupied goal is unreachable

  // Dense per-cell records indexed by cell id — a flat array, not a Map, so lookups are pure array
  // reads and there is no insertion-order to leak into a game decision.
  const records: Array<CellRecord | undefined> = new Array(graph.cellCount);

  // The start→goal line in WORLD coordinates, for the line-deviation tie-break: a cell's deviation is
  // the (unnormalised) cross product |Δcell × Δline| — zero on the line, growing with sideways drift.
  // Left unnormalised deliberately: it only ever compares against other candidates of the SAME search,
  // so the constant |Δline| factor cancels, and staying pure-integer keeps the search float-free.
  const cs = graph.coordsOf(start);
  const cg = graph.coordsOf(goal);
  const lineDx = fx.sub(
    worldX(fx.fromInt(cg.x), fx.fromInt(cg.y)),
    worldX(fx.fromInt(cs.x), fx.fromInt(cs.y)),
  );
  const lineDy = fx.mul(fx.fromInt(cg.y - cs.y), ROW_STEP);
  const deviation = (cell: CellId): Fixed => {
    const c = graph.coordsOf(cell);
    const dwx = fx.sub(worldX(fx.fromInt(c.x), fx.fromInt(c.y)), worldX(fx.fromInt(cs.x), fx.fromInt(cs.y)));
    const dwy = fx.mul(fx.fromInt(c.y - cs.y), ROW_STEP);
    return fx.abs(fx.sub(fx.mul(dwx, lineDy), fx.mul(dwy, lineDx)));
  };

  // At the start cell g is 0, so f === h; compute the heuristic once.
  const startH = cellLatticeDistance(graph, start, goal);
  records[start] = {
    cell: start,
    g: fx.fromInt(0),
    h: startH,
    f: startH,
    dev: fx.fromInt(0), // the start sits on its own line by definition
    cameFrom: null,
    open: true,
  };

  for (;;) {
    // Pop the canonical minimum from the open set: lowest f, ties to lowest h, then lowest deviation
    // from the start→goal line (cost-equal weaves resolve to the visually straight one), then lowest
    // cell id. Scanning the dense array in ascending id order makes the cell-id tie-break implicit and
    // the whole selection history-independent.
    let current: CellRecord | undefined;
    for (let id = 0; id < records.length; id++) {
      const r = records[id];
      if (r === undefined || !r.open) continue;
      if (
        current === undefined ||
        r.f < current.f ||
        (r.f === current.f && (r.h < current.h || (r.h === current.h && r.dev < current.dev)))
        // cell-id tie-break is implicit: we scan ascending and only replace on a strict improvement.
      ) {
        current = r;
      }
    }

    if (current === undefined) return null; // open set exhausted — unreachable
    if (current.cell === goal) return reconstruct(records, current);

    current.open = false; // close it — admissible heuristic means it is now settled

    // Lattice steps carry their own cost (column ONE, row-crossing ≈ ¾) and already exclude
    // blocked/unwalkable cells, so the search body just relaxes each.
    for (const { cell: next, cost } of graph.steps(current.cell, blocked)) {
      const tentativeG = fx.add(current.g, cost);
      const existing = records[next];
      if (existing === undefined) {
        const h = cellLatticeDistance(graph, next, goal);
        records[next] = {
          cell: next,
          g: tentativeG,
          h,
          f: fx.add(tentativeG, h),
          dev: deviation(next),
          cameFrom: current.cell,
          open: true,
        };
      } else if (existing.open && tentativeG < existing.g) {
        // A cheaper route to an already-discovered, still-open cell — relax it. (Closed cells are
        // never relaxed: with an admissible, consistent heuristic their g is already optimal.)
        existing.g = tentativeG;
        existing.f = fx.add(tentativeG, existing.h);
        existing.cameFrom = current.cell;
      }
    }
  }
}

/** Walk `cameFrom` back from the goal record to the start, returning the path in start→goal order. */
function reconstruct(records: ReadonlyArray<CellRecord | undefined>, goalRec: CellRecord): CellId[] {
  const path: CellId[] = [goalRec.cell];
  let cell: CellId | null = goalRec.cameFrom;
  while (cell !== null) {
    path.push(cell);
    const rec = records[cell];
    // The chain is built only from cells we discovered, so a record must exist; a missing one would
    // be a programmer error in the search above, not a recoverable boundary failure.
    if (rec === undefined) throw new Error(`path reconstruction hit an undiscovered cell ${cell}`);
    cell = rec.cameFrom;
  }
  path.reverse();
  return path;
}
