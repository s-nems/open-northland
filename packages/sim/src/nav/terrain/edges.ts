/**
 * Movement steps 8 directions, one half-cell fine: E/W `(+-1, 0)`, NE/SE/SW/NW `(+-1, +-2)` for the 51 px
 * lattice edge, and N/S `(0, +-1)`. Source basis for the set: `THexagonDirection` in the shipped
 * `Data/GameSourceIncludes/logicdefines.inc`, with NORTH = 6 and SOUTH = 7.
 *
 * Original behavior: the route search expands only the first six, a node's edges to its six neighbours
 * on a lattice whose odd rows sit half a node to +x, each gated by the map's per-node edge lane. Here an
 * E/W or N/S step is one such edge and a diagonal two in one direction, each needing the lane's bit, so
 * on every owned map our land joins exactly the original's. Approximation: route shapes. The edges that
 * shift a column, NW/SW from an even row and NE/SE from an odd one, have no step of their own and are
 * walked only inside a diagonal.
 *
 * Neighbours are emitted in a fixed canonical order so traversal is byte-identical across runs.
 */
import { HEX_EDGE, HEX_EDGE_COUNT } from '@open-northland/data';
import { type BlockOverlay, NodeMask } from '../block-overlay.js';
import { DIAGONAL_STEP, HALF_COLUMN, HALF_ROW } from '../world-metric.js';

import { TerrainLattice, type Traversal } from './lattice.js';
import type { NodeId } from './node-id.js';
import { type Step, StepBuffer } from './step-buffer.js';

/** The 4-connected orthogonal neighbour offsets, in canonical order. */
const NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [0, -1], // N
  [1, 0], // E
  [0, 1], // S
  [-1, 0], // W
] as const;

/** One bit per original edge direction, as the ground edge lane stores them. */
const EAST = 1 << HEX_EDGE.EAST;
const SOUTH_EAST = 1 << HEX_EDGE.SOUTH_EAST;
const SOUTH_WEST = 1 << HEX_EDGE.SOUTH_WEST;
const WEST = 1 << HEX_EDGE.WEST;
const NORTH_WEST = 1 << HEX_EDGE.NORTH_WEST;
const NORTH_EAST = 1 << HEX_EDGE.NORTH_EAST;
const ALL_EDGES = (1 << HEX_EDGE_COUNT) - 1;

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
   * The walkable subset of {@link neighbours} a walkable `node` is {@link joined} to, in the same order.
   * This is the adjacency relation for placement, not the pathfinder's edge set, which is 8-connected
   * through {@link steps}.
   */
  walkableNeighbours(node: NodeId): NodeId[] {
    const out: NodeId[] = [];
    out.length = this.walkableNeighboursInto(node, out);
    return out;
  }

  /** {@link walkableNeighbours} written into `out` from index 0, for a loop that reuses one array; returns
   *  how many it wrote. */
  walkableNeighboursInto(node: NodeId, out: NodeId[]): number {
    const x = this.xOf(node);
    const y = this.yOf(node);
    // A node no walker stands on, a trunk or a rock, borders its neighbours rather than stepping to them.
    const fromGround = this.isWalkable(node);
    let count = 0;
    for (let i = 0; i < NEIGHBOUR_OFFSETS.length; i++) {
      const offset = NEIGHBOUR_OFFSETS[i];
      if (offset === undefined) continue;
      const nx = x + offset[0];
      const ny = y + offset[1];
      if (!this.inBounds(nx, ny)) continue;
      const c = this.idAt(nx, ny);
      if (this.isWalkable(c) && (!fromGround || this.joined(node, c))) out[count++] = c;
    }
    return count;
  }

  /**
   * The pathfinder's 8-direction edge set from `node`, emitted in the order pinned by the pathfinding
   * goldens: E/W half-column steps, the four diagonals, then N/S half-row steps. A step costs the edge's
   * world length; the pathfinder weighs it by the destination's ground. A step onto a blocked or
   * unwalkable destination is omitted, and so is one along ground the original's edges do not join; a
   * diagonal additionally needs one of its two midpoint flanks passable.
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

  /**
   * {@link steps} emitted into a caller-owned buffer, which is reset first. Headings in emit order: E
   * `(+1, 0)`, W `(-1, 0)`, NE `(+1, -2)`, SE `(+1, +2)`, SW `(-1, +2)`, NW `(-1, -2)`, N `(0, -1)`,
   * S `(0, +1)`. A diagonal's flanks are the N or S node it shares with the vertical step and the node
   * one half-row along it on the far column.
   */
  stepsInto(
    node: NodeId,
    blocked: BlockOverlay | undefined,
    out: StepBuffer,
    traversal: Traversal = 'land',
  ): void {
    // A byte mask is read in place: one array read instead of a call through the overlay interface.
    const bytes = blocked instanceof NodeMask ? blocked.blocked : undefined;
    const width = this.width;
    const x = this.xOf(node);
    const y = this.yOf(node);
    out.reset();
    const east = x + 1 < width;
    const west = x > 0;
    const row = width;
    const twoRows = 2 * width;
    const odd = (y & 1) !== 0;
    const edges = this.edgeMaskAt(node);
    if (east && (edges & EAST) !== 0 && this.open(node + 1, blocked, bytes, traversal))
      out.push((node + 1) as NodeId, HALF_COLUMN);
    if (west && (edges & WEST) !== 0 && this.open(node - 1, blocked, bytes, traversal))
      out.push((node - 1) as NodeId, HALF_COLUMN);
    const north = y > 0 && this.open(node - row, blocked, bytes, traversal);
    const south = y + 1 < this.height && this.open(node + row, blocked, bytes, traversal);
    const northFar = y >= 2;
    const southFar = y + 2 < this.height;
    // A diagonal is two original edges in one direction, through the node half a row along it; both
    // midpoint flanks blocked is a wall joint, not a gap to slip through.
    if (
      east &&
      northFar &&
      this.twoEdges(edges, odd ? node + 1 - row : node - row, NORTH_EAST) &&
      this.open(node + 1 - twoRows, blocked, bytes, traversal)
    ) {
      if (north || this.open(node + 1 - row, blocked, bytes, traversal))
        out.push((node + 1 - twoRows) as NodeId, DIAGONAL_STEP);
    }
    if (
      east &&
      southFar &&
      this.twoEdges(edges, odd ? node + 1 + row : node + row, SOUTH_EAST) &&
      this.open(node + 1 + twoRows, blocked, bytes, traversal)
    ) {
      if (south || this.open(node + 1 + row, blocked, bytes, traversal))
        out.push((node + 1 + twoRows) as NodeId, DIAGONAL_STEP);
    }
    if (
      west &&
      southFar &&
      this.twoEdges(edges, odd ? node + row : node - 1 + row, SOUTH_WEST) &&
      this.open(node - 1 + twoRows, blocked, bytes, traversal)
    ) {
      if (south || this.open(node - 1 + row, blocked, bytes, traversal))
        out.push((node - 1 + twoRows) as NodeId, DIAGONAL_STEP);
    }
    if (
      west &&
      northFar &&
      this.twoEdges(edges, odd ? node - row : node - 1 - row, NORTH_WEST) &&
      this.open(node - 1 - twoRows, blocked, bytes, traversal)
    ) {
      if (north || this.open(node - 1 - row, blocked, bytes, traversal))
        out.push((node - 1 - twoRows) as NodeId, DIAGONAL_STEP);
    }
    // The node straight up or down a half row is the original's NE/SE neighbour on an even row and its
    // NW/SW one on an odd row.
    if (north && (edges & (odd ? NORTH_WEST : NORTH_EAST)) !== 0) out.push((node - row) as NodeId, HALF_ROW);
    if (south && (edges & (odd ? SOUTH_WEST : SOUTH_EAST)) !== 0) out.push((node + row) as NodeId, HALF_ROW);
  }

  /**
   * Whether the ground joins `node` to `next`, one of its {@link neighbours}: the original's edge between
   * them is open, or the map carries no edges. A search over the orthogonal neighbours asks it between
   * two nodes a mover stands on, so that it never crosses ground a step cannot.
   */
  joined(node: NodeId, next: NodeId): boolean {
    if (this.groundEdges === undefined) return true;
    const odd = (this.yOf(node) & 1) !== 0;
    const offset = next - node;
    let bit = 0;
    if (offset === -this.width) bit = odd ? NORTH_WEST : NORTH_EAST;
    else if (offset === this.width) bit = odd ? SOUTH_WEST : SOUTH_EAST;
    else if (offset === 1) bit = EAST;
    else if (offset === -1) bit = WEST;
    return (this.edgeMaskAt(node) & bit) !== 0;
  }

  /** The open ground edge bits of the in-bounds node id `c`, every bit when the map carries no edges. */
  private edgeMaskAt(c: number): number {
    return this.groundEdges === undefined ? ALL_EDGES : (this.groundEdges[c] ?? 0);
  }

  /** Whether the edge `bit` leaves a node whose mask is `edges` and leaves `middle` as well. */
  private twoEdges(edges: number, middle: number, bit: number): boolean {
    return (edges & bit) !== 0 && (this.edgeMaskAt(middle) & bit) !== 0;
  }

  /** Whether the in-bounds node id `c` is open to `traversal` and not masked by the dynamic `blocked`
   *  overlay. */
  private open(
    c: number,
    blocked: BlockOverlay | undefined,
    bytes: Uint8Array | undefined,
    traversal: Traversal,
  ): boolean {
    const id = c as NodeId;
    if (!(traversal === 'land' ? this.walkableAt(id) : this.isWater(id))) return false;
    if (bytes !== undefined) return bytes[id] !== 1;
    return !(blocked?.has(id) ?? false);
  }
}
