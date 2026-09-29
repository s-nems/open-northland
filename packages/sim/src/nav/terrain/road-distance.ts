import { type Fixed, fx } from '../../core/fixed.js';
import { DIAGONAL_STEP, HALF_COLUMN, HALF_ROW } from '../world-metric.js';

/** The share of the map's nodes a wavefront may settle before {@link RoadDistanceField.lower} hands
 *  over to the full rebuild: past it the rebuild's two raster passes are the cheaper route. Measured on
 *  a 480 x 380 node map, where a lone road in open ground re-settles nodes many times over. */
const WAVEFRONT_BUDGET_DIVISOR = 4;

/** The distance a node with no road on the map reads, in columns: past any map's lattice extent, and
 *  as a Fixed still clear of int32 overflow when a step is added to it. */
export const NO_ROAD_DISTANCE: Fixed = fx.fromInt(2 ** 14);

/**
 * Fill `out` with each node's obstacle-free lattice distance to the nearest road node, in column units,
 * over a row-major `width` x `height` half-cell grid: the route heuristic's lattice metric, so a node's
 * value never exceeds its lattice distance to any road. Two raster passes (a chamfer transform) are
 * exact here: a cheapest lattice walk takes diagonals and straight steps of one heading each, so it
 * reorders into a forward-pass part (down, or rightward) followed by a backward-pass part (up, or
 * leftward). O(nodes): the rebuild for a restore or a first road; {@link RoadDistanceField.lower} extends
 * the field as roads are laid.
 */
export function fillRoadDistances(
  out: Int32Array,
  width: number,
  height: number,
  roads: Iterable<number>,
): void {
  out.fill(NO_ROAD_DISTANCE);
  let any = false;
  for (const node of roads) {
    out[node] = 0;
    any = true;
  }
  if (!any) return;
  // Forward pass: each node takes over from its W, N, NW-diagonal and NE-diagonal neighbours.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let best = out[i] ?? NO_ROAD_DISTANCE;
      if (x > 0) best = Math.min(best, (out[i - 1] ?? NO_ROAD_DISTANCE) + HALF_COLUMN);
      if (y > 0) best = Math.min(best, (out[i - width] ?? NO_ROAD_DISTANCE) + HALF_ROW);
      if (y > 1) {
        const up = i - 2 * width;
        if (x > 0) best = Math.min(best, (out[up - 1] ?? NO_ROAD_DISTANCE) + DIAGONAL_STEP);
        if (x < width - 1) best = Math.min(best, (out[up + 1] ?? NO_ROAD_DISTANCE) + DIAGONAL_STEP);
      }
      out[i] = best;
    }
  }
  // Backward pass: the mirror image, from the E, S and both lower diagonal neighbours.
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      let best = out[i] ?? NO_ROAD_DISTANCE;
      if (x < width - 1) best = Math.min(best, (out[i + 1] ?? NO_ROAD_DISTANCE) + HALF_COLUMN);
      if (y < height - 1) best = Math.min(best, (out[i + width] ?? NO_ROAD_DISTANCE) + HALF_ROW);
      if (y < height - 2) {
        const down = i + 2 * width;
        if (x > 0) best = Math.min(best, (out[down - 1] ?? NO_ROAD_DISTANCE) + DIAGONAL_STEP);
        if (x < width - 1) best = Math.min(best, (out[down + 1] ?? NO_ROAD_DISTANCE) + DIAGONAL_STEP);
      }
      out[i] = best;
    }
  }
}

/**
 * A map's road distance lane with the scratch its incremental update reuses. Laying roads only lowers
 * distances, so {@link lower} relaxes a wavefront out of the new nodes over the chamfer passes' own edge
 * set and stops where no distance improves: its cost follows the nodes the new roads now serve, and the
 * result is the unique lattice distance a full rebuild computes, whatever the batching. A wavefront
 * that outgrows its budget finishes as a full rebuild instead, with the same result.
 */
export class RoadDistanceField {
  readonly distances: Int32Array;
  /** FIFO ring of nodes whose lowered distance still has to reach its neighbours; a node sits in it at
   *  most once, so the node count bounds it. */
  private readonly queue: Int32Array;
  private readonly queued: Uint8Array;

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    const nodeCount = width * height;
    this.distances = new Int32Array(nodeCount);
    this.queue = new Int32Array(nodeCount);
    this.queued = new Uint8Array(nodeCount);
  }

  rebuild(roads: Iterable<number>): void {
    fillRoadDistances(this.distances, this.width, this.height, roads);
  }

  /** Lower the field for `added` road nodes on top of the roads it already holds; `roads` is the whole
   *  network, `added` included, for the rebuild an outgrown wavefront falls back to. */
  lower(added: Iterable<number>, roads: Iterable<number>): void {
    const { distances, queue, queued, width, height } = this;
    const capacity = queue.length;
    let budget = Math.floor(capacity / WAVEFRONT_BUDGET_DIVISOR);
    let head = 0;
    let size = 0;
    for (const node of added) {
      if (distances[node] === 0) continue;
      distances[node] = 0;
      if (queued[node] === 1) continue;
      queued[node] = 1;
      queue[(head + size) % capacity] = node;
      size++;
    }
    const relax = (node: number, distance: number): void => {
      if (distance >= (distances[node] ?? 0)) return;
      distances[node] = distance;
      if (queued[node] === 1) return;
      queued[node] = 1;
      queue[(head + size) % capacity] = node;
      size++;
    };
    while (size > 0) {
      if (--budget < 0) {
        queued.fill(0);
        this.rebuild(roads);
        return;
      }
      const node = queue[head] ?? 0;
      head = (head + 1) % capacity;
      size--;
      queued[node] = 0;
      const base = distances[node] ?? NO_ROAD_DISTANCE;
      const x = node % width;
      const y = (node - x) / width;
      if (x > 0) relax(node - 1, base + HALF_COLUMN);
      if (x < width - 1) relax(node + 1, base + HALF_COLUMN);
      if (y > 0) relax(node - width, base + HALF_ROW);
      if (y < height - 1) relax(node + width, base + HALF_ROW);
      if (y > 1) {
        const up = node - 2 * width;
        if (x > 0) relax(up - 1, base + DIAGONAL_STEP);
        if (x < width - 1) relax(up + 1, base + DIAGONAL_STEP);
      }
      if (y < height - 2) {
        const down = node + 2 * width;
        if (x > 0) relax(down - 1, base + DIAGONAL_STEP);
        if (x < width - 1) relax(down + 1, base + DIAGONAL_STEP);
      }
    }
  }
}
