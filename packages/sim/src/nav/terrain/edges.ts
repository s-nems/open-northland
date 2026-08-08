/**
 * Movement keeps the original's 8 directions, one half-cell fine: E/W `(+-1, 0)`, NE/SE/SW/NW
 * `(+-1, +-2)` for the 51 px lattice edge, and N/S `(0, +-1)`. Source basis: `THexagonDirection` in the
 * shipped `Data/GameSourceIncludes/logicdefines.inc`, with NORTH = 6 and SOUTH = 7.
 *
 * Approximation: that the original walks this lattice rather than only blocking on it. No movement code
 * survives readable, but the direction set, edge geometry, and half-cell collision are data-pinned and
 * the observed unit packing density matches.
 *
 * Neighbours are emitted in a fixed canonical order so traversal is byte-identical across runs.
 */
import { fx } from '../../core/fixed.js';
import type { BlockOverlay } from '../block-overlay.js';
import { DIAGONAL_STEP, HALF_COLUMN, HALF_ROW } from '../world-metric.js';

import { TerrainLattice } from './lattice.js';
import type { NodeId } from './node-id.js';
import { type Step, StepBuffer } from './step-buffer.js';

/** The 4-connected orthogonal neighbour offsets, in canonical order. */
const NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [0, -1], // N
  [1, 0], // E
  [0, 1], // S
  [-1, 0], // W
] as const;

/** The two E/W half-column edges (34 px). */
const COLUMN_STEP_OFFSETS: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [1, 0], // E
  [-1, 0], // W
] as const;

/** The four 51 px diagonal lattice edges, in screen-heading order. */
const DIAGONAL_STEP_OFFSETS: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [1, -2], // NE
  [1, 2], // SE
  [-1, 2], // SW
  [-1, -2], // NW
] as const;

/** The two straight vertical 19 px half-row edges, in the `THexagonDirection` tail order. */
const VERTICAL_STEP_OFFSETS: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [0, -1], // N
  [0, 1], // S
] as const;

export abstract class TerrainEdges extends TerrainLattice {
  /** The in-bounds 4-connected neighbours of a node, in canonical order. */
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
   * The walkable subset of {@link neighbours}, in the same order. This is the adjacency relation for
   * placement, not the pathfinder's edge set, which is 8-connected through {@link steps}.
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
   * The pathfinder's 8-direction edge set from `node`, emitted in the order pinned by the pathfinding
   * goldens: E/W half-column steps, the four diagonals, then N/S half-row steps. A step costs the
   * destination node's {@link walkCost} times the edge's world length, so A* minimises true on-screen
   * distance. A step onto a blocked or unwalkable destination is omitted, and a diagonal additionally
   * needs one of its two midpoint flanks passable.
   *
   * The allocating form; hot callers use {@link stepsInto}.
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

  /** {@link steps} emitted into a caller-owned buffer, which is reset first. */
  stepsInto(node: NodeId, blocked: BlockOverlay | undefined, out: StepBuffer): void {
    const x = this.xOf(node);
    const y = this.yOf(node);
    out.reset();
    for (const [dx, dy] of COLUMN_STEP_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!this.passable(nx, ny, blocked)) continue;
      const c = this.idAt(nx, ny);
      out.push(c, fx.mul(this.walkCost(c), HALF_COLUMN));
    }
    for (const [dx, dy] of DIAGONAL_STEP_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!this.passable(nx, ny, blocked)) continue;
      const fy = y + dy / 2;
      // Both midpoint flanks blocked is a wall joint, not a gap to slip through.
      if (!this.passable(x, fy, blocked) && !this.passable(nx, fy, blocked)) continue;
      const c = this.idAt(nx, ny);
      out.push(c, fx.mul(this.walkCost(c), DIAGONAL_STEP));
    }
    for (const [dx, dy] of VERTICAL_STEP_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!this.passable(nx, ny, blocked)) continue;
      const c = this.idAt(nx, ny);
      out.push(c, fx.mul(this.walkCost(c), HALF_ROW));
    }
  }

  /** Whether `(nx, ny)` is in bounds, walkable, and not masked by the dynamic `blocked` overlay. */
  private passable(nx: number, ny: number, blocked?: BlockOverlay): boolean {
    if (!this.inBounds(nx, ny)) return false;
    const c = this.idAt(nx, ny);
    return this.isWalkable(c) && !(blocked?.has(c) ?? false);
  }
}
