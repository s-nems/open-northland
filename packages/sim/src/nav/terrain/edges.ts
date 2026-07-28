/**
 * Movement keeps the original's 8 directions (`THexagonDirection`: E/SE/SW/W/NW/NE plus NORTH = 6,
 * SOUTH = 7, from the shipped `Data/GameSourceIncludes/logicdefines.inc`), one half-cell fine
 * ({@link TerrainEdges.steps}): E/W = `(±1, 0)`, NE/SE/SW/NW = `(±1, ±2)` (the 51 px lattice edge),
 * N/S = `(0, ±1)`. That the original walks this lattice (rather than only blocking on it) is a named
 * approximation. No movement code survives readable, but the direction set, edge geometry, and
 * half-cell collision are data-pinned and the observed unit packing density matches it. E/W and N/S
 * connect directly adjacent nodes, so walkability is a property of the destination node.
 *
 * Determinism: neighbours emitted in a fixed canonical order so traversal is byte-identical across
 * runs. All costs are `Fixed`.
 */
import { fx } from '../../core/fixed.js';
import type { BlockOverlay } from '../block-overlay.js';
import { DIAGONAL_STEP, HALF_COLUMN, HALF_ROW } from '../world-metric.js';

import { TerrainLattice } from './lattice.js';
import type { NodeId } from './node-id.js';
import { type Step, StepBuffer } from './step-buffer.js';

/** Canonical orthogonal neighbour offsets in N, E, S, W order — the fixed traversal order for
 *  determinism. */
const NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [0, -1], // N
  [1, 0], // E
  [0, 1], // S
  [-1, 0], // W
] as const;

/** The two E/W half-column edges (34 px), canonical E then W. */
const COLUMN_STEP_OFFSETS: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [1, 0], // E
  [-1, 0], // W
] as const;

/** The four diagonal lattice edges (`(±1, ±2)`, 51 px) in canonical NE, SE, SW, NW screen-heading
 *  order — the fixed order (after E/W) keeps A* expansion history-independent. */
const DIAGONAL_STEP_OFFSETS: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [1, -2], // NE
  [1, 2], // SE
  [-1, 2], // SW
  [-1, -2], // NW
] as const;

/** The two straight vertical edges (19 px half-row), canonical N then S — the `THexagonDirection`
 *  enum tail (NORTH = 6, SOUTH = 7). */
const VERTICAL_STEP_OFFSETS: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [0, -1], // N
  [0, 1], // S
] as const;

export abstract class TerrainEdges extends TerrainLattice {
  /**
   * The in-bounds 4-connected neighbours of a node, in canonical N, E, S, W order. Border nodes simply
   * yield fewer neighbours.
   */
  neighbours(node: NodeId): NodeId[] {
    const x = this.xOf(node);
    const y = this.yOf(node);
    const out: NodeId[] = [];
    for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (this.inBounds(nx, ny)) out.push(this.idAt(nx, ny));
    }
    return out;
  }

  /**
   * The walkable subset of {@link neighbours} (4-connected), same canonical order — the adjacency
   * relation for placement, not the pathfinder's edge set (movement is 8-connected via {@link steps}).
   */
  walkableNeighbours(node: NodeId): NodeId[] {
    const x = this.xOf(node);
    const y = this.yOf(node);
    const out: NodeId[] = [];
    for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!this.inBounds(nx, ny)) continue;
      const c = this.idAt(nx, ny);
      if (this.isWalkable(c)) out.push(c);
    }
    return out;
  }

  /**
   * The pathfinder's 8-direction edge set from `node`: E/W half-column steps, then the four diagonals
   * (NE, SE, SW, NW), then N/S half-row steps. Each step's cost is the destination node's
   * {@link walkCost} × the edge's world length (E/W = {@link HALF_COLUMN}, diagonal =
   * {@link DIAGONAL_STEP}, vertical = {@link HALF_ROW}), so A* minimises true on-screen distance.
   * `blocked` is the dynamic walk-block overlay; a step onto a blocked or unwalkable destination is
   * omitted, and a diagonal additionally needs at least one of its two midpoint flanks passable (both
   * blocked = a wall joint, not a gap). The emission order is pinned by the pathfinding goldens and
   * must not be reordered.
   *
   * The allocating form, kept for the tests and diagnostics that read an edge set as a value; every
   * hot caller uses {@link stepsInto} instead.
   */
  steps(node: NodeId, blocked?: BlockOverlay): Step[] {
    const buf = new StepBuffer();
    this.stepsInto(node, blocked, buf);
    const out: Step[] = [];
    for (let i = 0; i < buf.length; i++) {
      const step = buf.at(i);
      out.push({ node: step.node, cost: step.cost });
    }
    return out;
  }

  /**
   * {@link steps}, emitted into a caller-owned buffer instead of a fresh array — the allocation-free
   * form the A* inner loop and the component flood fill use, since they consume each edge set and
   * drop it. `out` is reset first and holds the edges in the same canonical order.
   */
  stepsInto(node: NodeId, blocked: BlockOverlay | undefined, out: StepBuffer): void {
    const x = this.xOf(node);
    const y = this.yOf(node);
    out.reset();
    // Half-column steps first, canonical E then W.
    for (const [dx, dy] of COLUMN_STEP_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!this.passable(nx, ny, blocked)) continue;
      const c = this.idAt(nx, ny);
      out.push(c, fx.mul(this.walkCost(c), HALF_COLUMN));
    }
    // Diagonal steps, canonical NE,SE,SW,NW — gated on the flanked midpoint seam.
    for (const [dx, dy] of DIAGONAL_STEP_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!this.passable(nx, ny, blocked)) continue;
      const fy = y + dy / 2;
      if (!this.passable(x, fy, blocked) && !this.passable(nx, fy, blocked)) continue;
      const c = this.idAt(nx, ny);
      out.push(c, fx.mul(this.walkCost(c), DIAGONAL_STEP));
    }
    // Vertical half-row steps last, canonical N then S (the THexagonDirection tail order).
    for (const [dx, dy] of VERTICAL_STEP_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!this.passable(nx, ny, blocked)) continue;
      const c = this.idAt(nx, ny);
      out.push(c, fx.mul(this.walkCost(c), HALF_ROW));
    }
  }

  /** Whether `(nx, ny)` is in bounds, walkable, and not currently masked by the dynamic `blocked`
   *  overlay — the per-step passability test {@link stepsInto} applies to each candidate edge. */
  private passable(nx: number, ny: number, blocked?: BlockOverlay): boolean {
    if (!this.inBounds(nx, ny)) return false;
    const c = this.idAt(nx, ny);
    return this.isWalkable(c) && !(blocked?.has(c) ?? false);
  }
}
