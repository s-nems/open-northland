import { type Fixed, fx } from '../../core/fixed.js';
import { DIAGONAL_STEP, HALF_COLUMN, HALF_ROW } from '../world-metric.js';

/** The share of the map's nodes a wavefront may settle before {@link RoadDistanceField.lower} hands
 *  over to the full rebuild. Measured on a 480 x 380 node map: the rebuild costs about as much as
 *  settling 100k nodes and a lone road settles about 5k, so only a large batch falls back. */
const WAVEFRONT_BUDGET_DIVISOR = 4;

/** The distance a node with no road on the map reads, in columns: past any map's lattice extent, and
 *  as a Fixed still clear of int32 overflow when a step is added to it. */
export const NO_ROAD_DISTANCE: Fixed = fx.fromInt(2 ** 14);

/**
 * The farthest a road reaches in the field, in columns: a node this far or farther from every road reads
 * {@link NO_ROAD_DISTANCE}, so one lay settles at most the nodes within this reach of it. The route
 * heuristic only counts a road nearer than a third of the way to the goal, so the reach trims routes of
 * 48 columns and more. Authored: on magiczny_las routes match an unbounded field from 24 columns up,
 * and at 16 cost 0.3% more between towns.
 */
export const ROAD_DISTANCE_REACH: Fixed = fx.fromInt(16);

/** Per edge length, the most steps of that length a settled node takes: its wavefront queue's share
 *  of the settle budget. */
const ROW_STEPS_PER_NODE = 2;
const COLUMN_STEPS_PER_NODE = 2;
const DIAGONAL_STEPS_PER_NODE = 4;

/** The last wavefront generation before the settle stamps wrap and are cleared. */
const MAX_GENERATION = 2 ** 31 - 1;

/** The nearest road of a node no road reaches. */
export const NO_NEAREST_ROAD = -1;

const NO_NODE = -1;

/**
 * Fill `distances` with each node's obstacle-free lattice distance to the nearest road node, in column
 * units, over a row-major `width` x `height` half-cell grid, and `nearest` with that road node, the least
 * id among equally near ones. It is the route heuristic's lattice metric. Nodes beyond
 * {@link ROAD_DISTANCE_REACH} read {@link NO_ROAD_DISTANCE} and {@link NO_NEAREST_ROAD}. Two raster
 * passes (a chamfer transform) are exact here: a cheapest lattice walk takes diagonals and straight steps
 * of one heading each, so it reorders into a forward-pass part (down, or rightward) followed by a
 * backward-pass part (up, or leftward). O(nodes): the rebuild for a restore or a first road;
 * {@link RoadDistanceField.lower} extends the field as roads are laid.
 */
export function fillRoadDistances(
  distances: Int32Array,
  nearest: Int32Array,
  width: number,
  height: number,
  roads: Iterable<number>,
): void {
  distances.fill(NO_ROAD_DISTANCE);
  nearest.fill(NO_NEAREST_ROAD);
  let any = false;
  for (const node of roads) {
    distances[node] = 0;
    nearest[node] = node;
    any = true;
  }
  if (!any) return;
  // Forward pass: each node takes over from its W, N, NW-diagonal and NE-diagonal neighbours.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (x > 0) offerRoad(distances, nearest, i, i - 1, HALF_COLUMN);
      if (y > 0) offerRoad(distances, nearest, i, i - width, HALF_ROW);
      if (y > 1) {
        const up = i - 2 * width;
        if (x > 0) offerRoad(distances, nearest, i, up - 1, DIAGONAL_STEP);
        if (x < width - 1) offerRoad(distances, nearest, i, up + 1, DIAGONAL_STEP);
      }
      clampToReach(distances, nearest, i);
    }
  }
  // Backward pass: the mirror image, from the E, S and both lower diagonal neighbours.
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (x < width - 1) offerRoad(distances, nearest, i, i + 1, HALF_COLUMN);
      if (y < height - 1) offerRoad(distances, nearest, i, i + width, HALF_ROW);
      if (y < height - 2) {
        const down = i + 2 * width;
        if (x > 0) offerRoad(distances, nearest, i, down - 1, DIAGONAL_STEP);
        if (x < width - 1) offerRoad(distances, nearest, i, down + 1, DIAGONAL_STEP);
      }
      clampToReach(distances, nearest, i);
    }
  }
}

/** Let node `i` take `from`'s nearest road over a step of `length`: {@link takeNearerRoad} with the
 *  reads inlined, for the rebuild's raster passes. */
function offerRoad(
  distances: Int32Array,
  nearest: Int32Array,
  i: number,
  from: number,
  length: number,
): void {
  const distance = (distances[from] ?? NO_ROAD_DISTANCE) + length;
  const known = distances[i] ?? NO_ROAD_DISTANCE;
  if (distance > known) return;
  const road = nearest[from] ?? NO_NEAREST_ROAD;
  if (distance === known && road >= (nearest[i] ?? NO_NEAREST_ROAD)) return;
  distances[i] = distance;
  nearest[i] = road;
}

/** Give node `i` `road` at `distance` when that is nearer than what it holds, or as near with a lower id;
 *  returns whether it did. */
function takeNearerRoad(
  distances: Int32Array,
  nearest: Int32Array,
  i: number,
  distance: number,
  road: number,
): boolean {
  const known = distances[i] ?? NO_ROAD_DISTANCE;
  if (distance > known || (distance === known && road >= (nearest[i] ?? NO_NEAREST_ROAD))) return false;
  distances[i] = distance;
  nearest[i] = road;
  return true;
}

function clampToReach(distances: Int32Array, nearest: Int32Array, i: number): void {
  if ((distances[i] ?? NO_ROAD_DISTANCE) < ROAD_DISTANCE_REACH) return;
  distances[i] = NO_ROAD_DISTANCE;
  nearest[i] = NO_NEAREST_ROAD;
}

/**
 * A map's road distance and nearest-road lanes with the scratch their incremental update reuses. Laying
 * roads only lowers distances, so {@link lower} runs a Dijkstra out of the new nodes over the chamfer
 * passes' own edge set and stops where no node improves. The lattice has three edge lengths, so the open
 * set is one FIFO per length: a settled node's steps of one length join that length's queue in settle
 * order, which keeps each queue sorted, and the least of the three heads settles next. Each node settles
 * once, so a lay costs the nodes it brings nearer to a road (or to a lower-id road as near), and the
 * result is what a full rebuild computes, whatever the batching. A wavefront that outgrows its budget
 * finishes as a full rebuild instead, with the same result.
 */
export class RoadDistanceField {
  readonly distances: Int32Array;
  /** Per node, its nearest road node, or {@link NO_NEAREST_ROAD}. */
  readonly nearest: Int32Array;
  /** Settles one lay may take before the rebuild takes over. */
  private readonly budget: number;
  /** Per edge length, the nodes a step of that length improved, sized for the budget; the row queue also
   *  leads with the new roads. A node may sit in several; entries after its first settle are skipped. */
  private readonly rowQueue: Int32Array;
  private readonly columnQueue: Int32Array;
  private readonly diagonalQueue: Int32Array;
  /** The {@link generation} of the wavefront that settled each node. */
  private readonly settledIn: Int32Array;
  private generation = 0;

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    const nodeCount = width * height;
    this.budget = Math.floor(nodeCount / WAVEFRONT_BUDGET_DIVISOR);
    this.distances = new Int32Array(nodeCount);
    this.nearest = new Int32Array(nodeCount);
    this.rowQueue = new Int32Array(nodeCount + ROW_STEPS_PER_NODE * this.budget);
    this.columnQueue = new Int32Array(COLUMN_STEPS_PER_NODE * this.budget);
    this.diagonalQueue = new Int32Array(DIAGONAL_STEPS_PER_NODE * this.budget);
    this.settledIn = new Int32Array(nodeCount);
  }

  rebuild(roads: Iterable<number>): void {
    fillRoadDistances(this.distances, this.nearest, this.width, this.height, roads);
  }

  /** Lower the field for `added` road nodes on top of the roads it already holds; `roads` is the whole
   *  network, `added` included, for the rebuild an outgrown wavefront falls back to. */
  lower(added: Iterable<number>, roads: Iterable<number>): void {
    const { distances, nearest, rowQueue, columnQueue, diagonalQueue, settledIn, width, height } = this;
    if (this.generation === MAX_GENERATION) {
      settledIn.fill(0);
      this.generation = 0;
    }
    const generation = ++this.generation;
    let rowHead = 0;
    let rowTail = 0;
    let columnHead = 0;
    let columnTail = 0;
    let diagonalHead = 0;
    let diagonalTail = 0;
    // A road reads 0, under any step, so the new ones lead the row queue.
    for (const node of added) {
      if (takeNearerRoad(distances, nearest, node, 0, node)) rowQueue[rowTail++] = node;
    }
    for (let settles = 0; ; settles++) {
      while (rowHead < rowTail && settledIn[rowQueue[rowHead] ?? 0] === generation) rowHead++;
      while (columnHead < columnTail && settledIn[columnQueue[columnHead] ?? 0] === generation) columnHead++;
      while (diagonalHead < diagonalTail && settledIn[diagonalQueue[diagonalHead] ?? 0] === generation) {
        diagonalHead++;
      }
      let node = NO_NODE;
      let nodeDistance: number = NO_ROAD_DISTANCE;
      if (rowHead < rowTail) {
        node = rowQueue[rowHead] ?? NO_NODE;
        nodeDistance = distances[node] ?? NO_ROAD_DISTANCE;
      }
      if (columnHead < columnTail) {
        const candidate = columnQueue[columnHead] ?? NO_NODE;
        const distance = distances[candidate] ?? NO_ROAD_DISTANCE;
        if (node === NO_NODE || distance < nodeDistance) {
          node = candidate;
          nodeDistance = distance;
        }
      }
      if (diagonalHead < diagonalTail) {
        const candidate = diagonalQueue[diagonalHead] ?? NO_NODE;
        const distance = distances[candidate] ?? NO_ROAD_DISTANCE;
        if (node === NO_NODE || distance < nodeDistance) {
          node = candidate;
          nodeDistance = distance;
        }
      }
      if (node === NO_NODE) return;
      if (settles === this.budget) {
        this.rebuild(roads);
        return;
      }
      // The winning head is the node itself; its stamp skips it at the next scan.
      settledIn[node] = generation;
      const road = nearest[node] ?? NO_NEAREST_ROAD;
      const x = node % width;
      const y = (node - x) / width;
      const byColumn = nodeDistance + HALF_COLUMN;
      const byRow = nodeDistance + HALF_ROW;
      const byDiagonal = nodeDistance + DIAGONAL_STEP;
      // Steps past the reach take nothing; the column and diagonal steps are longer than the row step.
      if (byRow >= ROAD_DISTANCE_REACH) continue;
      if (y > 0 && takeNearerRoad(distances, nearest, node - width, byRow, road))
        rowQueue[rowTail++] = node - width;
      if (y < height - 1 && takeNearerRoad(distances, nearest, node + width, byRow, road)) {
        rowQueue[rowTail++] = node + width;
      }
      if (byColumn < ROAD_DISTANCE_REACH) {
        if (x > 0 && takeNearerRoad(distances, nearest, node - 1, byColumn, road))
          columnQueue[columnTail++] = node - 1;
        if (x < width - 1 && takeNearerRoad(distances, nearest, node + 1, byColumn, road)) {
          columnQueue[columnTail++] = node + 1;
        }
      }
      if (byDiagonal >= ROAD_DISTANCE_REACH) continue;
      if (y > 1) {
        const up = node - 2 * width;
        if (x > 0 && takeNearerRoad(distances, nearest, up - 1, byDiagonal, road))
          diagonalQueue[diagonalTail++] = up - 1;
        if (x < width - 1 && takeNearerRoad(distances, nearest, up + 1, byDiagonal, road)) {
          diagonalQueue[diagonalTail++] = up + 1;
        }
      }
      if (y < height - 2) {
        const down = node + 2 * width;
        if (x > 0 && takeNearerRoad(distances, nearest, down - 1, byDiagonal, road)) {
          diagonalQueue[diagonalTail++] = down - 1;
        }
        if (x < width - 1 && takeNearerRoad(distances, nearest, down + 1, byDiagonal, road)) {
          diagonalQueue[diagonalTail++] = down + 1;
        }
      }
    }
  }
}
