/**
 * A node's edges to its six lattice neighbours: the pathfinder's single steps, and the adjacency of every
 * search that decides where a walker can step, such as stands, evictions and door passages. The range
 * floods (`range-search.ts`) walk the same six neighbours without the edge gate. Source basis for the
 * set: `THexagonDirection` in the shipped `Data/GameSourceIncludes/logicdefines.inc` (E, SE, SW, W, NW,
 * NE, then NORTH = 6 and SOUTH = 7, which only a found route's walk takes:
 * `pathfinding/straight-steps.ts`). Original behavior: the route search expands only those six, on a
 * lattice whose odd rows sit half a node to +x, a person's each gated by the map's per-node edge lane.
 * Deviation: the original's vehicle search ignores the lane and gates only by the destination's blocked
 * state and size class; here the lane gates every traversal. In integer coordinates that shift is the parity rule of the
 * row-crossing edges: from an even row NE and SE keep the column and NW and SW shift a column west,
 * from an odd row NW and SW keep it and NE and SE shift a column east. The edges connect exactly what
 * the original's connect, and all four row-crossing edges are one length (`ROW_EDGE`), so the pathfinder
 * takes these six steps alone.
 *
 * Neighbours are emitted in a fixed canonical order so traversal is byte-identical across runs.
 */
import { HEX_EDGE, HEX_EDGE_COUNT, hexEdgeNeighbourX, hexEdgeNeighbourY } from '@open-northland/data';
import type { Fixed } from '../../core/fixed.js';
import type { BlockOverlay } from '../block-overlay.js';
import { HALF_COLUMN, ROW_EDGE } from '../world-metric.js';

import { ENTER_BIT, TerrainLattice, type Traversal } from './lattice.js';
import type { NodeId } from './node-id.js';
import { type Step, StepBuffer } from './step-buffer.js';

/** One bit per original edge direction, as the ground edge lane stores them. */
const EAST = 1 << HEX_EDGE.EAST;
const SOUTH_EAST = 1 << HEX_EDGE.SOUTH_EAST;
const SOUTH_WEST = 1 << HEX_EDGE.SOUTH_WEST;
const WEST = 1 << HEX_EDGE.WEST;
const NORTH_WEST = 1 << HEX_EDGE.NORTH_WEST;
const NORTH_EAST = 1 << HEX_EDGE.NORTH_EAST;
const ALL_EDGES = (1 << HEX_EDGE_COUNT) - 1;

/** The six edges in bit order, the canonical neighbour order: E, SE, SW, W, NW, NE. */
const EDGE_BITS: readonly number[] = [EAST, SOUTH_EAST, SOUTH_WEST, WEST, NORTH_WEST, NORTH_EAST];
const EVEN_ROW = 0;
const ODD_ROW = 1;
/** Each edge's column offset from an even row and from an odd row, and its row offset. */
const EDGE_DX_EVEN: readonly number[] = EDGE_BITS.map((_, edge) => hexEdgeNeighbourX(0, EVEN_ROW, edge));
const EDGE_DX_ODD: readonly number[] = EDGE_BITS.map((_, edge) => hexEdgeNeighbourX(0, ODD_ROW, edge));
const EDGE_DY: readonly number[] = EDGE_BITS.map((_, edge) => hexEdgeNeighbourY(0, edge));
/** The column a slant edge shifts from an even row (SW and NW) and from an odd one (SE and NE). */
const SLANT_DX_EVEN = hexEdgeNeighbourX(0, EVEN_ROW, HEX_EDGE.SOUTH_WEST);
const SLANT_DX_ODD = hexEdgeNeighbourX(0, ODD_ROW, HEX_EDGE.SOUTH_EAST);

/** The column the two slant edges of row `y` shift, up or down: -1 (west) from an even row, +1 (east)
 *  from an odd one. A walk heading `dx` can take a slant from row `y` only when `dx * slantDx(y) > 0`. */
export function slantDx(y: number): number {
  return (y & 1) === 0 ? SLANT_DX_EVEN : SLANT_DX_ODD;
}

/** {@link TerrainEdges.resetGate}'s `readmitted` when no node is exempt from the overlay. */
export const NO_READMITTED = -1;

/**
 * Which nodes a walk-block overlay closes to a step, read through the overlay's byte lanes when it has
 * them. Reset per search or per emission, never shared between two at once.
 */
export class StepGate {
  /** The edges a step may take from each node over static ground, as {@link TerrainEdges.stepLane}. */
  lane: Uint8Array = new Uint8Array(0);
  private readmitted = NO_READMITTED;
  private overlay: BlockOverlay | undefined;
  private bytes: Uint8Array | undefined;
  private extra: Uint8Array | undefined;
  private unsure: Uint8Array | undefined;
  private players: Uint16Array | undefined;
  private hostile = 0;

  reset(lane: Uint8Array, blocked: BlockOverlay | undefined, readmitted: number): void {
    this.lane = lane;
    this.readmitted = readmitted;
    const lanes = blocked?.blockLanes?.();
    this.unsure = lanes?.unsure;
    this.overlay = lanes === undefined || this.unsure !== undefined ? blocked : undefined;
    this.bytes = lanes?.bytes;
    this.extra = lanes?.extra;
    this.players = lanes?.players;
    this.hostile = lanes?.hostile ?? 0;
  }

  /** Whether the overlay closes the in-bounds node id `c`. */
  closes(c: number): boolean {
    if (c === this.readmitted) return false;
    const bytes = this.bytes;
    if (bytes !== undefined) {
      if (bytes[c] === 1) return true;
      const extra = this.extra;
      if (extra !== undefined && extra[c] === 1) return true;
      const unsure = this.unsure;
      if (unsure !== undefined && unsure[c] === 1) return this.overlay?.has(c as NodeId) === true;
      const players = this.players;
      return players !== undefined && ((players[c] ?? 0) & this.hostile) !== 0;
    }
    return this.overlay?.has(c as NodeId) === true;
  }
}

/** Each edge's world length in bit order: the two column edges are a half column, the four row-crossing
 *  ones {@link ROW_EDGE}. */
export const STEP_COSTS: Float64Array = Float64Array.from(EDGE_BITS, (_, edge) =>
  EDGE_DY[edge] === 0 ? HALF_COLUMN : ROW_EDGE,
);

/** Each edge's row offset in bit order. */
export const STEP_ROWS: Int32Array = Int32Array.from(EDGE_BITS, (_, edge) => EDGE_DY[edge] ?? 0);

export abstract class TerrainEdges extends TerrainLattice {
  /** {@link stepsInto}'s gate, reset on every call. */
  private readonly callGate = new StepGate();
  private landSteps: Uint8Array | undefined;
  private waterSteps: Uint8Array | undefined;
  /** Each edge's node id offset from an even row and from an odd one, in {@link EDGE_BITS} order. */
  private readonly evenOffsets = Int32Array.from(EDGE_BITS, (_, edge) => this.edgeOffset(edge, EDGE_DX_EVEN));
  private readonly oddOffsets = Int32Array.from(EDGE_BITS, (_, edge) => this.edgeOffset(edge, EDGE_DX_ODD));

  private edgeOffset(edge: number, dxs: readonly number[]): number {
    return (EDGE_DY[edge] ?? 0) * this.width + (dxs[edge] ?? 0);
  }

  /** The in-bounds lattice neighbours of a node, in canonical order, whatever the ground between. */
  neighbours(node: NodeId): NodeId[] {
    const out: NodeId[] = [];
    this.neighboursInto(node, out);
    return out;
  }

  /** {@link neighbours} written into `out` from index 0, for a loop that reuses one array; returns how
   *  many it wrote. */
  neighboursInto(node: NodeId, out: NodeId[]): number {
    const x = this.xOf(node);
    const y = this.yOf(node);
    const dxs = (y & 1) === 0 ? EDGE_DX_EVEN : EDGE_DX_ODD;
    let count = 0;
    for (let i = 0; i < EDGE_BITS.length; i++) {
      const nx = x + (dxs[i] ?? 0);
      const ny = y + (EDGE_DY[i] ?? 0);
      if (this.inBounds(nx, ny)) out[count++] = this.idAt(nx, ny);
    }
    return count;
  }

  /**
   * The walkable subset of {@link neighbours} a walkable `node` is {@link joined} to, in the same order:
   * the nodes a walker standing on `node` can step to in one edge.
   */
  walkableNeighbours(node: NodeId): NodeId[] {
    const out: NodeId[] = [];
    this.walkableNeighboursInto(node, out);
    return out;
  }

  /** {@link walkableNeighbours} written into `out` from index 0, for a loop that reuses one array; returns
   *  how many it wrote. */
  walkableNeighboursInto(node: NodeId, out: NodeId[]): number {
    const x = this.xOf(node);
    const y = this.yOf(node);
    const dxs = (y & 1) === 0 ? EDGE_DX_EVEN : EDGE_DX_ODD;
    // A node no walker stands on, a trunk or a rock, borders its neighbours rather than stepping to them.
    const edges = this.isWalkable(node) ? this.edgeMaskAt(node) : ALL_EDGES;
    let count = 0;
    for (let i = 0; i < EDGE_BITS.length; i++) {
      if ((edges & (EDGE_BITS[i] ?? 0)) === 0) continue;
      const nx = x + (dxs[i] ?? 0);
      const ny = y + (EDGE_DY[i] ?? 0);
      if (!this.inBounds(nx, ny)) continue;
      const c = this.idAt(nx, ny);
      if (this.isWalkable(c)) out[count++] = c;
    }
    return count;
  }

  /**
   * The pathfinder's edge set from `node`: the six lattice edges in canonical order. A step costs the
   * edge's world length; the pathfinder weighs it by the destination's ground. A step onto a blocked or
   * unwalkable destination is omitted, and so is one along ground the original's edges do not join.
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
  stepsInto(
    node: NodeId,
    blocked: BlockOverlay | undefined,
    out: StepBuffer,
    traversal: Traversal = 'land',
  ): void {
    const gate = this.callGate;
    this.resetGate(gate, traversal, blocked, NO_READMITTED);
    this.stepsIntoAt(node, this.yOf(node), gate, out);
  }

  /** Point `gate` at `traversal`'s ground under `blocked`, with `readmitted` (or {@link NO_READMITTED})
   *  open whatever the overlay says. */
  resetGate(
    gate: StepGate,
    traversal: Traversal,
    blocked: BlockOverlay | undefined,
    readmitted: number,
  ): void {
    gate.reset(this.stepLane(traversal), blocked, readmitted);
  }

  /** {@link stepsInto} through a gate {@link resetGate} prepared, for a caller that already holds `node`'s
   *  row `y`. */
  stepsIntoAt(node: NodeId, y: number, gate: StepGate, out: StepBuffer): void {
    out.reset();
    const open = gate.lane[node] ?? 0;
    if (open === 0) return;
    const offsets = this.stepOffsets(y);
    // Bit order is the canonical neighbour order.
    for (let edge = 0; edge < HEX_EDGE_COUNT; edge++) {
      if ((open & (1 << edge)) === 0) continue;
      const next = node + (offsets[edge] ?? 0);
      if (!gate.closes(next)) out.push(next as NodeId, (STEP_COSTS[edge] ?? ROW_EDGE) as Fixed);
    }
  }

  /** Each edge's node id offset from a node on row `y`, in the bit order of {@link StepGate.lane}. A
   *  search walking a lane's bits itself steps by these and costs a step by {@link STEP_COSTS}. */
  stepOffsets(y: number): Int32Array {
    return (y & 1) === 0 ? this.evenOffsets : this.oddOffsets;
  }

  /**
   * Per node, the edges a mover of `traversal` may step along over static ground: the neighbour is in
   * bounds, the ground lane joins the two and the mover may stand on the neighbour. Bit `1 << i` stands for
   * the `i`th edge of the canonical neighbour order, as the lane's readers test it; built on the first ask,
   * since the terrain never changes.
   */
  private stepLane(traversal: Traversal): Uint8Array {
    const held = traversal === 'land' ? this.landSteps : this.waterSteps;
    if (held !== undefined) return held;
    const enter = this.enterLane(traversal);
    const lane = new Uint8Array(this.nodeCount);
    for (let y = 0; y < this.height; y++) {
      const dxs = (y & 1) === 0 ? EDGE_DX_EVEN : EDGE_DX_ODD;
      for (let x = 0; x < this.width; x++) {
        const node = this.idAt(x, y);
        const edges = this.edgeMaskAt(node);
        let open = 0;
        for (let edge = 0; edge < HEX_EDGE_COUNT; edge++) {
          const bit = EDGE_BITS[edge] ?? 0;
          const nx = x + (dxs[edge] ?? 0);
          const ny = y + (EDGE_DY[edge] ?? 0);
          if ((edges & bit) === 0 || !this.inBounds(nx, ny)) continue;
          if (((enter[this.idAt(nx, ny)] ?? 0) & ENTER_BIT) !== 0) open |= 1 << edge;
        }
        lane[node] = open;
      }
    }
    if (traversal === 'land') this.landSteps = lane;
    else this.waterSteps = lane;
    return lane;
  }

  /**
   * Whether the ground joins `node` to `next`, one of its {@link neighbours}: the original's edge between
   * them is open, or the map carries no edges. False for a node that is no lattice neighbour. A search
   * over the neighbours asks it between two nodes a mover stands on, so that it never crosses ground a
   * step cannot.
   */
  joined(node: NodeId, next: NodeId): boolean {
    const y = this.yOf(node);
    const dx = this.xOf(next) - this.xOf(node);
    const dy = this.yOf(next) - y;
    const dxs = (y & 1) === 0 ? EDGE_DX_EVEN : EDGE_DX_ODD;
    for (let i = 0; i < EDGE_BITS.length; i++) {
      if (dxs[i] === dx && EDGE_DY[i] === dy) return (this.edgeMaskAt(node) & (EDGE_BITS[i] ?? 0)) !== 0;
    }
    return false;
  }

  /** The open ground edge bits of the in-bounds node id `c`, every bit when the map carries no edges. */
  private edgeMaskAt(c: number): number {
    return this.groundEdges === undefined ? ALL_EDGES : (this.groundEdges[c] ?? 0);
  }
}
