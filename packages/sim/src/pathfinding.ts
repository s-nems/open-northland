/**
 * A* pathfinding over the terrain CELL-ADJACENCY GRAPH (docs/ROADMAP.md, Phase 2).
 *
 * This is the pure search the PathfindingSystem drives. It walks {@link TerrainGraph.walkableNeighbours}
 * (the canonical N,E,S,W edge set), using {@link cellManhattanDistance} as the admissible heuristic and
 * {@link TerrainGraph.walkCost} as the per-step edge cost. The result is the lowest-cost cell sequence
 * from `start` to `goal`, inclusive of both, or `null` when no walkable route exists.
 *
 * DETERMINISM: every tie is broken by a fixed, history-independent rule so two runs (or two clients in
 * lockstep) pick byte-identical paths. The open set is a flat array scanned for the canonical minimum —
 * never a Map/Set whose iteration order is insertion-history-dependent. The minimum is chosen by
 * (lowest f, then lowest h, then lowest cell id); neighbours are expanded in the graph's canonical
 * order. No floats touch the search: all costs are {@link Fixed}. `start`/`goal` must be walkable —
 * an unwalkable endpoint yields `null` (no route), not a throw, since it is a recoverable query.
 */
import { type Fixed, fx } from './fixed.js';
import { type CellId, type TerrainGraph, cellManhattanDistance } from './terrain.js';

/** A* per-cell bookkeeping. `g` = best known cost from start; `f` = g + heuristic; `h` = heuristic. */
interface CellRecord {
  readonly cell: CellId;
  g: Fixed;
  f: Fixed;
  h: Fixed;
  /** Predecessor cell on the best known path, or null for the start cell. */
  cameFrom: CellId | null;
  /** False once popped from the open set (closed) — a settled cell is never re-expanded. */
  open: boolean;
}

/**
 * Find the lowest-cost walkable path from `start` to `goal` on the cell graph, inclusive of both
 * endpoints. Returns `null` when no route exists or either endpoint is unwalkable. `start === goal`
 * yields the single-cell path `[start]` (when walkable).
 */
export function findPath(graph: TerrainGraph, start: CellId, goal: CellId): CellId[] | null {
  if (!graph.isWalkable(start) || !graph.isWalkable(goal)) return null;
  if (start === goal) return [start];

  // Dense per-cell records indexed by cell id — a flat array, not a Map, so lookups are pure array
  // reads and there is no insertion-order to leak into a game decision.
  const records: Array<CellRecord | undefined> = new Array(graph.cellCount);
  // At the start cell g is 0, so f === h; compute the heuristic once.
  const startH = cellManhattanDistance(graph, start, goal);
  records[start] = {
    cell: start,
    g: fx.fromInt(0),
    h: startH,
    f: startH,
    cameFrom: null,
    open: true,
  };

  for (;;) {
    // Pop the canonical minimum from the open set: lowest f, ties to lowest h, then lowest cell id.
    // Scanning the dense array in ascending id order makes the cell-id tie-break implicit and the
    // whole selection history-independent.
    let current: CellRecord | undefined;
    for (let id = 0; id < records.length; id++) {
      const r = records[id];
      if (r === undefined || !r.open) continue;
      if (
        current === undefined ||
        r.f < current.f ||
        (r.f === current.f && r.h < current.h)
        // cell-id tie-break is implicit: we scan ascending and only replace on a strict improvement.
      ) {
        current = r;
      }
    }

    if (current === undefined) return null; // open set exhausted — unreachable
    if (current.cell === goal) return reconstruct(records, current);

    current.open = false; // close it — admissible heuristic means it is now settled

    for (const next of graph.walkableNeighbours(current.cell)) {
      const tentativeG = fx.add(current.g, graph.walkCost(next));
      const existing = records[next];
      if (existing === undefined) {
        const h = cellManhattanDistance(graph, next, goal);
        records[next] = {
          cell: next,
          g: tentativeG,
          h,
          f: fx.add(tentativeG, h),
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
