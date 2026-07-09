/**
 * A* pathfinding over the terrain HALF-CELL ADJACENCY GRAPH (docs/plans/, Phase 2).
 *
 * This is the pure search the PathfindingSystem drives. It walks {@link TerrainGraph.steps} (the
 * canonical 8-direction half-cell edge set: E,W then NE,SE,SW,NW then the vertical N,S), using
 * {@link cellLatticeDistance} as the admissible heuristic and each step's own cost (its real world
 * length: half-column ½, diagonal ≈ ¾, half-row ≈ 0.28) as the edge cost. The result is the
 * lowest-cost node sequence from `start` to `goal`, inclusive of both, or `null` when no walkable
 * route exists — minimising TRUE on-screen distance, so a route reads straight under the staggered
 * raster.
 *
 * DETERMINISM: every tie is broken by a fixed, history-independent rule so two runs (or two clients in
 * lockstep) pick byte-identical paths. The open set is a flat array scanned for the canonical minimum —
 * never a Map/Set whose iteration order is insertion-history-dependent. The minimum is chosen by
 * (lowest f, then lowest h, then lowest deviation from the start→goal line, then lowest cell id);
 * neighbours are expanded in the graph's canonical order. The open array is scanned in FULL and the
 * winner compared by that total order, so its internal ordering (swap-removal churn) can never leak
 * into the pick. The LINE-DEVIATION key only ever separates routes that already tie on cost, so
 * optimality is untouched — its job is visual: the lattice offers many equal-cost weaves to the same
 * node, and without it the id tie-break picks one that drifts sideways before correcting; with it
 * the route hugs the straight screen line a player expects. It is a pure function of (node, start,
 * goal) world coordinates — no history, so lockstep-safe. No floats touch the search: all costs are
 * {@link Fixed}. `start`/`goal` must be walkable — an unwalkable endpoint yields `null` (no route),
 * not a throw, since it is a recoverable query.
 */
import { type Fixed, fx } from '../core/fixed.js';
import { type CellId, type TerrainGraph, cellLatticeDistance } from './terrain.js';

/** A* per-node bookkeeping. `g` = best known cost from start; `f` = g + heuristic; `h` = heuristic. */
interface CellRecord {
  readonly cell: CellId;
  g: Fixed;
  f: Fixed;
  h: Fixed;
  /** The node's deviation from the start→goal line (the visual-straightness tie-break) — a PLAIN
   *  integer cross product in half-cell units (only its ordering matters: each axis's true world
   *  scale is a constant factor multiplying both cross terms alike), a pure function of the node +
   *  endpoints computed once at discovery, never path-dependent. Exact integers well under 2^53
   *  even on huge maps — no Fixed mul overflow. */
  readonly dev: number;
  /** Predecessor node on the best known path, or null for the start node. */
  cameFrom: CellId | null;
  /** False once popped from the open set (closed) — a settled node is never re-expanded. */
  open: boolean;
}

/** The canonical open-set order: (f, h, dev, cell id), all ascending — a TOTAL order (the id last),
 *  so the pick is independent of the open array's internal layout. */
function betterRecord(a: CellRecord, b: CellRecord): boolean {
  if (a.f !== b.f) return a.f < b.f;
  if (a.h !== b.h) return a.h < b.h;
  if (a.dev !== b.dev) return a.dev < b.dev;
  return a.cell < b.cell;
}

/**
 * Find the lowest-cost walkable path from `start` to `goal` on the half-cell graph, inclusive of
 * both endpoints. Returns `null` when no route exists or either endpoint is unwalkable.
 * `start === goal` yields the single-node path `[start]` (when walkable).
 *
 * `blocked` is the DYNAMIC walk-block overlay (standing building bodies and resource footprints —
 * see `dynamicBlockedCells`), applied on top of the graph's static terrain walkability: a blocked
 * node is never entered (goal included), but a blocked START is deliberately exempt — an entity
 * standing where a foundation just appeared must be able to step OFF the footprint (its first move
 * leaves the blocked node; it can never move back in).
 */
export function findPath(
  graph: TerrainGraph,
  start: CellId,
  goal: CellId,
  blocked?: ReadonlySet<CellId>,
): CellId[] | null {
  if (!graph.isWalkable(start) || !graph.isWalkable(goal)) return null;
  // Already-there wins over the overlay: consistent with the blocked-START exemption, an entity
  // standing on its own (even occupied) goal node trivially succeeds rather than reading "unreachable".
  if (start === goal) return [start];
  if (blocked?.has(goal)) return null; // an occupied goal is unreachable

  // Dense per-node records indexed by cell id — a flat array, not a Map, so lookups are pure array
  // reads and there is no insertion-order to leak into a game decision.
  const records: Array<CellRecord | undefined> = new Array(graph.cellCount);

  // The start→goal line for the line-deviation tie-break: a node's deviation is the (unnormalised)
  // cross product |Δnode × Δline| — zero on the line, growing with sideways drift. Computed in PLAIN
  // exact integers over raw half-cell coordinates (each axis's true world scale — ×½ column,
  // ×19/68 column — is a constant factor that multiplies BOTH cross terms alike, so the ordering —
  // all a tie-break needs — is unchanged, while the magnitudes stay ≤ ~2·span², exact far past any
  // map size). Unnormalised is fine: it only ever compares against candidates of the SAME search,
  // so the |Δline| factor cancels too.
  const cs = graph.coordsOf(start);
  const cg = graph.coordsOf(goal);
  const lineHX = cg.x - cs.x;
  const lineHY = cg.y - cs.y;
  const deviation = (cell: CellId): number => {
    const c = graph.coordsOf(cell);
    return Math.abs((c.x - cs.x) * lineHY - (c.y - cs.y) * lineHX);
  };

  // At the start node g is 0, so f === h; compute the heuristic once.
  const startH = cellLatticeDistance(graph, start, goal);
  const startRec: CellRecord = {
    cell: start,
    g: fx.fromInt(0),
    h: startH,
    f: startH,
    dev: 0, // the start sits on its own line by definition
    cameFrom: null,
    open: true,
  };
  records[start] = startRec;
  // The OPEN list — the still-open records only, so a pop scans the frontier, not the whole grid
  // (the dense records array made each pop O(cellCount); at half-cell resolution that is 4× the old
  // node count, so the frontier list is what keeps long routes affordable). Membership mirrors
  // `record.open`: pushed at discovery, swap-removed at pop; a relaxation only mutates costs. The
  // pick below compares by the TOTAL canonical order, so the swap-removal churn of this array's
  // internal order can never change a winner.
  const open: CellRecord[] = [startRec];

  for (;;) {
    // Pop the canonical minimum from the open set: lowest f, ties to lowest h, then lowest deviation
    // from the start→goal line (cost-equal weaves resolve to the visually straight one), then lowest
    // cell id.
    if (open.length === 0) return null; // open set exhausted — unreachable
    let currentIdx = 0;
    for (let i = 1; i < open.length; i++) {
      const r = open[i];
      const c = open[currentIdx];
      if (r !== undefined && c !== undefined && betterRecord(r, c)) currentIdx = i;
    }
    const current = open[currentIdx];
    if (current === undefined) return null; // unreachable: currentIdx indexes a non-empty array

    if (current.cell === goal) return reconstruct(records, current);

    // Close it — admissible heuristic means it is now settled. Swap-remove from the open list.
    current.open = false;
    const last = open.pop();
    if (last !== undefined && last !== current) open[currentIdx] = last;

    // Lattice steps carry their own cost and already exclude blocked/unwalkable nodes, so the
    // search body just relaxes each.
    for (const { cell: next, cost } of graph.steps(current.cell, blocked)) {
      const tentativeG = fx.add(current.g, cost);
      const existing = records[next];
      if (existing === undefined) {
        const h = cellLatticeDistance(graph, next, goal);
        const rec: CellRecord = {
          cell: next,
          g: tentativeG,
          h,
          f: fx.add(tentativeG, h),
          dev: deviation(next),
          cameFrom: current.cell,
          open: true,
        };
        records[next] = rec;
        open.push(rec);
      } else if (existing.open && tentativeG < existing.g) {
        // A cheaper route to an already-discovered, still-open node — relax it. (Closed nodes are
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
