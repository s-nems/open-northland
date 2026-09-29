import type { Fixed } from '../../core/fixed.js';
import { latticeOffsetDistance } from './lattice-distance.js';

/** The widest grid side the bounding boxes' 16-bit coordinates hold. */
const MAX_GRID_SIDE = 2 ** 15;

/** The network label of a node no road runs over. */
export const NO_ROAD_NETWORK = -1;

/**
 * The connected road networks of a half-cell grid as a union-find over its road nodes: two road nodes
 * share a network when a chain of road nodes joins them over the lattice's eight edges. Roads are only
 * added between rebuilds, so a lay only merges networks. A root is the least node id of its network, so
 * labels are a pure function of the road set; path halving on lookup changes no label.
 */
export class RoadNetworks {
  /** Per node, its parent in the forest, itself at a root, or {@link NO_ROAD_NETWORK} off the roads. */
  private readonly parent: Int32Array;
  /** Per root, its network's bounding box. */
  private readonly minX: Int16Array;
  private readonly maxX: Int16Array;
  private readonly minY: Int16Array;
  private readonly maxY: Int16Array;

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {
    if (width > MAX_GRID_SIDE || height > MAX_GRID_SIDE) {
      throw new Error(`road networks hold grid sides up to ${MAX_GRID_SIDE}, not ${width} x ${height}`);
    }
    const nodeCount = width * height;
    this.parent = new Int32Array(nodeCount).fill(NO_ROAD_NETWORK);
    this.minX = new Int16Array(nodeCount);
    this.maxX = new Int16Array(nodeCount);
    this.minY = new Int16Array(nodeCount);
    this.maxY = new Int16Array(nodeCount);
  }

  clear(): void {
    this.parent.fill(NO_ROAD_NETWORK);
  }

  /** Put a road on `node` and merge it with the networks of the roads beside it. */
  add(node: number): void {
    if (this.parent[node] !== NO_ROAD_NETWORK) return;
    const { width, height } = this;
    const x = node % width;
    const y = (node - x) / width;
    this.parent[node] = node;
    this.minX[node] = x;
    this.maxX[node] = x;
    this.minY[node] = y;
    this.maxY[node] = y;
    if (x > 0) this.join(node, node - 1);
    if (x < width - 1) this.join(node, node + 1);
    if (y > 0) this.join(node, node - width);
    if (y < height - 1) this.join(node, node + width);
    if (y > 1) {
      const up = node - 2 * width;
      if (x > 0) this.join(node, up - 1);
      if (x < width - 1) this.join(node, up + 1);
    }
    if (y < height - 2) {
      const down = node + 2 * width;
      if (x > 0) this.join(node, down - 1);
      if (x < width - 1) this.join(node, down + 1);
    }
  }

  /** The label of the network `node` belongs to, or {@link NO_ROAD_NETWORK} off the roads. */
  networkOf(node: number): number {
    const { parent } = this;
    let current = node;
    let up = parent[current] ?? NO_ROAD_NETWORK;
    if (up === NO_ROAD_NETWORK) return NO_ROAD_NETWORK;
    while (up !== current) {
      const grand = parent[up] ?? up;
      parent[current] = grand;
      current = grand;
      up = parent[current] ?? current;
    }
    return current;
  }

  /** The lattice distance from `(x, y)` to the nearest point of `network`'s bounding box, 0 inside it:
   *  at most its distance to any road of the network, but for the lattice's odd-row quirk, which puts a
   *  point one half-row farther off under a column step closer by a fraction of one. */
  gapTo(network: number, x: number, y: number): Fixed {
    const dx = Math.max(0, (this.minX[network] ?? x) - x, x - (this.maxX[network] ?? x));
    const dy = Math.max(0, (this.minY[network] ?? y) - y, y - (this.maxY[network] ?? y));
    return latticeOffsetDistance(dx, dy);
  }

  private join(node: number, neighbour: number): void {
    const other = this.networkOf(neighbour);
    if (other === NO_ROAD_NETWORK) return;
    const own = this.networkOf(node);
    if (own === other) return;
    const root = Math.min(own, other);
    const child = Math.max(own, other);
    this.parent[child] = root;
    this.minX[root] = Math.min(this.minX[root] ?? 0, this.minX[child] ?? 0);
    this.maxX[root] = Math.max(this.maxX[root] ?? 0, this.maxX[child] ?? 0);
    this.minY[root] = Math.min(this.minY[root] ?? 0, this.minY[child] ?? 0);
    this.maxY[root] = Math.max(this.maxY[root] ?? 0, this.maxY[child] ?? 0);
  }
}
