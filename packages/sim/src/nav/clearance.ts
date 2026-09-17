import { footprintCellDx } from '@open-northland/data';
import { HEX_NEIGHBOUR_OFFSETS } from './halfcell.js';
import type { NodeId, TerrainGraph } from './terrain/index.js';

/**
 * The largest free-size class a node can hold. The original stores the class in 3 bits beside the
 * node's blocked bit; how it computes the class is open, and Open Northland's reading is the
 * hex-disc radius below (docs/formats/VEHICLES.md "Movement").
 */
export const MAX_CLEARANCE_CLASS = 7;

/** Whether a node counts as open ground for the clearance: static walkable and not walk-blocked. */
export type ClearanceProbe = (node: NodeId) => boolean;

/** The class of a node no open node hemmed in within the cap, and of a node that is not open itself. */
const UNREACHED = -1;

/** How far a change reaches in the scan: the rewritten disc's radius again beyond it. */
const SCAN_RADIUS = 2 * (MAX_CLEARANCE_CLASS + 1);
/** Map points in a hexagon disc of the scan radius: `1 + 3 r (r + 1)`. */
const SCAN_DISC_NODES = 1 + 3 * SCAN_RADIUS * (SCAN_RADIUS + 1);

/**
 * Per-node free-size classes over a terrain graph: a node's class is the largest hexagon-disc radius
 * around it whose every map point is in bounds, open (`probe`) and in the node's own static
 * component, capped at {@link MAX_CLEARANCE_CLASS}. A vehicle of `logicSize` s may enter a node
 * whose class is at least s. A node that is not open reads 0.
 *
 * Computed as a multi-source breadth-first distance over the six map-point neighbours: an open node
 * with a hemming neighbour (off the map, not open, or of another component) is at distance 0, and the
 * distance grows by one per ring inward. A hemming point at hexagon distance d from a node puts an open
 * node of distance d-1 on the shortest walk toward it, so the breadth-first distance is exactly the
 * disc radius. {@link recompute} over a region redoes only that region: a node's class depends on the
 * points within `MAX_CLEARANCE_CLASS + 1` of it, so a change at a point reaches twice that far in the
 * scan and once that far in the result.
 */
export class ClearanceField {
  private readonly classes: Uint8Array;
  private readonly distance: Int16Array;
  private readonly queue: NodeId[] = [];

  constructor(
    private readonly graph: TerrainGraph,
    probe: ClearanceProbe,
  ) {
    this.classes = new Uint8Array(graph.nodeCount);
    this.distance = new Int16Array(graph.nodeCount);
    this.recompute(probe, null);
  }

  classOf(node: NodeId): number {
    const value = this.classes[node];
    if (value === undefined) throw new Error(`node id ${node} out of range (0..${this.graph.nodeCount - 1})`);
    return value;
  }

  /**
   * Recompute the classes of every node within `MAX_CLEARANCE_CLASS + 1` of `changed`, or of the whole
   * map for null. The scan region reaches twice as far so every hemming point that can decide a
   * rewritten class is inside it; the breadth-first walk stays inside the scan region, which is
   * exact because a shortest walk of length at most the cap from a rewritten node never leaves it.
   */
  recompute(probe: ClearanceProbe, changed: Iterable<NodeId> | null): void {
    const { graph } = this;
    const distance = this.distance;
    const queue = this.queue;
    // Past the point where the changes' scan discs outnumber the map, one full pass is the cheaper scan.
    const centres = changed === null ? null : [...changed];
    const local = centres !== null && centres.length * SCAN_DISC_NODES < graph.nodeCount;
    const rewrite = local ? this.discAround(centres, MAX_CLEARANCE_CLASS + 1) : null;
    const scan = local ? this.discAround(centres, SCAN_RADIUS) : null;
    const inScan = (node: NodeId): boolean => scan === null || scan.has(node);
    const scanned = (): Iterable<NodeId> => scan ?? nodeRange(graph.nodeCount);

    queue.length = 0;
    for (const node of scanned()) {
      if (!probe(node)) {
        distance[node] = UNREACHED;
        continue;
      }
      distance[node] = this.hemmed(node, probe) ? 0 : UNREACHED;
      if (distance[node] === 0) queue.push(node);
    }
    // The array iterator re-reads `length`, so `queue` is a live breadth-first queue.
    for (const current of queue) {
      const next = (distance[current] ?? 0) + 1;
      if (next > MAX_CLEARANCE_CLASS) continue;
      const x = graph.xOf(current);
      const y = graph.yOf(current);
      const component = graph.componentOf(current);
      for (const offset of HEX_NEIGHBOUR_OFFSETS) {
        const nx = x + footprintCellDx(y, offset);
        const ny = y + offset.dy;
        if (!graph.inBounds(nx, ny)) continue;
        const neighbour = graph.nodeAt(nx, ny);
        if (!inScan(neighbour) || distance[neighbour] !== UNREACHED) continue;
        if (!probe(neighbour) || graph.componentOf(neighbour) !== component) continue;
        distance[neighbour] = next;
        queue.push(neighbour);
      }
    }
    for (const node of rewrite ?? scanned()) {
      const d = distance[node] ?? UNREACHED;
      this.classes[node] = !probe(node) ? 0 : d === UNREACHED ? MAX_CLEARANCE_CLASS : d;
    }
    queue.length = 0;
  }

  /** Whether an open node touches a hemming map point: off the map, not open, or of another component. */
  private hemmed(node: NodeId, probe: ClearanceProbe): boolean {
    const { graph } = this;
    const x = graph.xOf(node);
    const y = graph.yOf(node);
    const component = graph.componentOf(node);
    for (const offset of HEX_NEIGHBOUR_OFFSETS) {
      const nx = x + footprintCellDx(y, offset);
      const ny = y + offset.dy;
      if (!graph.inBounds(nx, ny)) return true;
      const neighbour = graph.nodeAt(nx, ny);
      if (!probe(neighbour) || graph.componentOf(neighbour) !== component) return true;
    }
    return false;
  }

  /** The in-bounds nodes within `radius` map-point steps of any of `centres`, as one set. */
  private discAround(centres: Iterable<NodeId>, radius: number): Set<NodeId> {
    const { graph } = this;
    const disc = new Set<NodeId>();
    const ring: NodeId[] = [];
    for (const centre of centres) {
      // A breadth-first flood over the six neighbours, ignoring passability: a disc, not a region.
      const depth = new Map<NodeId, number>([[centre, 0]]);
      ring.length = 0;
      ring.push(centre);
      for (const current of ring) {
        disc.add(current);
        const d = depth.get(current) ?? 0;
        if (d >= radius) continue;
        const x = graph.xOf(current);
        const y = graph.yOf(current);
        for (const offset of HEX_NEIGHBOUR_OFFSETS) {
          const nx = x + footprintCellDx(y, offset);
          const ny = y + offset.dy;
          if (!graph.inBounds(nx, ny)) continue;
          const neighbour = graph.nodeAt(nx, ny);
          if (depth.has(neighbour)) continue;
          depth.set(neighbour, d + 1);
          ring.push(neighbour);
        }
      }
    }
    return disc;
  }
}

function* nodeRange(count: number): Generator<NodeId> {
  for (let node = 0; node < count; node++) yield node as NodeId;
}
