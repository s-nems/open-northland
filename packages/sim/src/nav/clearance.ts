import { HEX_DX_EVEN, HEX_DX_ODD, HEX_DY } from './range-search.js';
import type { NodeId, TerrainGraph } from './terrain/index.js';

/**
 * The largest free-size class a node can hold. The original stores the class in 3 bits beside the
 * node's blocked bit; how it computes the class is open, and Open Northland's reading is the
 * hex-disc radius below (docs/formats/VEHICLES.md "Movement").
 */
export const MAX_CLEARANCE_CLASS = 7;

/** Whether a node counts as open ground for the clearance: land a settler walks or water a ship sails,
 *  neither walk-blocked. Land and water never share a component, so each side hems the other. */
export type ClearanceProbe = (node: NodeId) => boolean;

/** The class of a node no open node hemmed in within the cap, and of a node that is not open itself. */
const UNREACHED = -1;

/** How far a change reaches in the result: a hemming point d steps from a node caps its class at d - 1,
 *  so past the cap's own distance none moves a class. */
const REWRITE_RADIUS = MAX_CLEARANCE_CLASS;
/** How far a local recompute scans: the rewritten disc and the ring just past it, whose nodes keep their
 *  classes and seed the walk inward with them. */
const SCAN_RADIUS = REWRITE_RADIUS + 1;
/** Disc stamps are Uint16; on the wrap the stamps clear so no stale slot matches a reused generation. */
const MAX_DISC_GENERATION = 0xffff;
/** Map points in a hexagon disc of the scan radius: `1 + 3 r (r + 1)`. */
const SCAN_DISC_NODES = 1 + 3 * SCAN_RADIUS * (SCAN_RADIUS + 1);
/** Queue and disc slots a field starts with. */
const INITIAL_QUEUE_CAPACITY = 1024;
/** Slots a queue or disc may keep after a pass; a larger one, as a whole-map pass grows, is dropped so it
 *  does not pin a map-sized buffer. */
const MAX_RETAINED_CAPACITY = 1 << 16;

const NEIGHBOURS = HEX_DY.length;
/** A node's {@link ClearanceField} neighbour bits when every neighbour is on the map and of its component. */
const ALL_JOINED = (1 << NEIGHBOURS) - 1;

function neighbourDxOf(y: number): readonly number[] {
  return (y & 1) !== 0 ? HEX_DX_ODD : HEX_DX_EVEN;
}

/** `buffer` with room for one more entry past `used`, doubled when full. */
function withRoom(buffer: Int32Array, used: number): Int32Array {
  if (used < buffer.length) return buffer;
  const grown = new Int32Array(buffer.length * 2);
  grown.set(buffer);
  return grown;
}

/**
 * Per-node free-size classes over a terrain graph: a node's class is the largest hexagon-disc radius
 * around it whose every map point is in bounds, open (`probe`) and in the node's own static
 * component, capped at {@link MAX_CLEARANCE_CLASS}. A vehicle of `logicSize` s may stand on a node
 * whose class is at least s, and a ship sails only such nodes; one field serves land and sea, since a
 * water node's disc holds only water of its own body. A node that is not open reads 0.
 *
 * Computed as a multi-source breadth-first distance over the six map-point neighbours: an open node
 * with a hemming neighbour (off the map, not open, or of another component) is at distance 0, and the
 * distance grows by one per ring inward. A hemming point at hexagon distance d from a node puts an open
 * node of distance d-1 on the shortest walk toward it, so the breadth-first distance is exactly the
 * disc radius. {@link recompute} over a region redoes only that region: a node's class depends on the
 * points within {@link MAX_CLEARANCE_CLASS} of it, so a change rewrites the nodes that close to it, and
 * the ring one step farther, whose classes the change cannot reach, seeds the walk into them at the
 * distance it holds. `probe` is read once per scanned node.
 */
export class ClearanceField {
  private readonly classes: Uint8Array;
  /** Breadth-first distance, -1 to {@link MAX_CLEARANCE_CLASS}. */
  private readonly distance: Int8Array;
  /** The probe's answer per scanned node, read once per pass: 1 open, 0 not. */
  private readonly open: Uint8Array;
  /** Per node, bit i set when its i-th neighbour (in `HEX_DY` order) is on the map and of its static
   *  component, so the hot loops test neither. Static, like the components. */
  private readonly joined: Uint8Array;
  /** Per row parity, even then odd, the node-id step to each neighbour. */
  private readonly steps: readonly [Int32Array, Int32Array];
  /** The breadth-first walk's nodes per distance below the cap, the first {@link levelSizes} slots of each
   *  live; a node at the cap leads nowhere, so it is never queued. */
  private readonly levels: Int32Array[] = Array.from(
    { length: MAX_CLEARANCE_CLASS },
    () => new Int32Array(INITIAL_QUEUE_CAPACITY),
  );
  private readonly levelSizes = new Int32Array(MAX_CLEARANCE_CLASS);
  /** The last local recompute's scan disc, its first {@link discSize} slots: its nodes, each stamped with
   *  the generation and its map-point depth from the nearest change, so membership and the rewrite cut
   *  are array reads. */
  private disc: Int32Array = new Int32Array(INITIAL_QUEUE_CAPACITY);
  private discSize = 0;
  private readonly discStamps: Uint16Array;
  private readonly discDepths: Uint8Array;
  private discGeneration = 0;
  /** Per class `k`, how many times a water node's class crossed `k`: went from below it to at least it,
   *  or back. */
  private readonly waterCrossings = new Uint32Array(MAX_CLEARANCE_CLASS + 1);
  /** Per hull size asked for, 1 on every node whose class is below it, kept by {@link write}. */
  private readonly belowLanes = new Map<number, Uint8Array>();

  constructor(
    private readonly graph: TerrainGraph,
    probe: ClearanceProbe,
  ) {
    this.classes = new Uint8Array(graph.nodeCount);
    this.distance = new Int8Array(graph.nodeCount);
    this.open = new Uint8Array(graph.nodeCount);
    const { width } = graph;
    this.steps = [
      Int32Array.from(HEX_DX_EVEN, (dx, i) => (HEX_DY[i] ?? 0) * width + dx),
      Int32Array.from(HEX_DX_ODD, (dx, i) => (HEX_DY[i] ?? 0) * width + dx),
    ];
    this.joined = joinedNeighbours(graph);
    this.discStamps = new Uint16Array(graph.nodeCount);
    this.discDepths = new Uint8Array(graph.nodeCount);
    this.recompute(probe, null);
  }

  classOf(node: NodeId): number {
    const value = this.classes[node];
    if (value === undefined) throw new Error(`node id ${node} out of range (0..${this.graph.nodeCount - 1})`);
    return value;
  }

  /** 1 on every node whose class is below `logicSize`, 0 elsewhere: the {@link classOf} test a route
   *  search or a flood reads as an array. Live, kept by every recompute; never written by a reader. */
  belowLane(logicSize: number): Uint8Array {
    const held = this.belowLanes.get(logicSize);
    if (held !== undefined) return held;
    const { classes } = this;
    const lane = new Uint8Array(classes.length);
    for (let node = 0; node < classes.length; node++) lane[node] = (classes[node] ?? 0) < logicSize ? 1 : 0;
    this.belowLanes.set(logicSize, lane);
    return lane;
  }

  /** Changes whenever a water node's class crosses `logicSize`, which is all a hull of that size reads
   *  of it, and never for land, where blockers come and go all game: a cache over the sea outlives every
   *  edit on shore and every narrowing too slight to matter. */
  waterRevision(logicSize: number): number {
    return this.waterCrossings[logicSize] ?? 0;
  }

  /**
   * Recompute the classes of every node within {@link MAX_CLEARANCE_CLASS} of `changed`, or of the whole
   * map for null. The ring one step past that keeps its classes, which no change reached, and enters the
   * walk at them: any walk out of the rewritten disc crosses that ring, so the distances inside come out
   * as a whole-map walk would leave them.
   */
  recompute(probe: ClearanceProbe, changed: ReadonlySet<NodeId> | null): void {
    const { graph, open } = this;
    // Past the point where the changes' scan discs outnumber the map, one full pass is the cheaper scan.
    const local = changed !== null && changed.size * SCAN_DISC_NODES < graph.nodeCount;
    this.levelSizes.fill(0);
    if (local) {
      this.markDisc(changed);
      const { disc, discDepths } = this;
      const discSize = this.discSize;
      for (let i = 0; i < discSize; i++) {
        const node = (disc[i] ?? 0) as NodeId;
        open[node] = probe(node) ? 1 : 0;
      }
      for (let i = 0; i < discSize; i++) {
        const node = (disc[i] ?? 0) as NodeId;
        if ((discDepths[node] ?? SCAN_RADIUS) <= REWRITE_RADIUS) this.seed(node);
        else this.seedFromHeld(node);
      }
      this.walk(true);
      for (let i = 0; i < discSize; i++) {
        const node = (disc[i] ?? 0) as NodeId;
        if ((discDepths[node] ?? SCAN_RADIUS) <= REWRITE_RADIUS) this.write(node);
      }
    } else {
      for (let node = 0 as NodeId; node < graph.nodeCount; node++) open[node] = probe(node) ? 1 : 0;
      for (let node = 0 as NodeId; node < graph.nodeCount; node++) this.seed(node);
      this.walk(false);
      for (let node = 0 as NodeId; node < graph.nodeCount; node++) this.write(node);
    }
    for (let level = 0; level < MAX_CLEARANCE_CLASS; level++) {
      if ((this.levels[level]?.length ?? 0) > MAX_RETAINED_CAPACITY) {
        this.levels[level] = new Int32Array(INITIAL_QUEUE_CAPACITY);
      }
    }
    if (this.disc.length > MAX_RETAINED_CAPACITY) this.disc = new Int32Array(INITIAL_QUEUE_CAPACITY);
  }

  /** Walk the queued levels outward in distance order, settling each node the first time a level reaches
   *  it: open, of the walking node's component, unsettled, and in the rewritten disc of a `local` pass. */
  private walk(local: boolean): void {
    const { graph, distance, open, joined, steps, discStamps, discDepths, levels, levelSizes } = this;
    const { width } = graph;
    const scanned = this.discGeneration;
    for (let level = 0; level < MAX_CLEARANCE_CLASS; level++) {
      const next = level + 1;
      // The level's queue is read through `levels`: a discovery one level up may replace that queue only.
      const queue = levels[level] as Int32Array;
      const size = levelSizes[level] ?? 0;
      for (let at = 0; at < size; at++) {
        const current = queue[at] ?? 0;
        const bits = joined[current] ?? 0;
        const step = steps[Math.floor(current / width) & 1] as Int32Array;
        for (let i = 0; i < NEIGHBOURS; i++) {
          if ((bits & (1 << i)) === 0) continue;
          const neighbour = (current + (step[i] ?? 0)) as NodeId;
          if (local && (discStamps[neighbour] !== scanned || (discDepths[neighbour] ?? 0) > REWRITE_RADIUS)) {
            continue;
          }
          if (distance[neighbour] !== UNREACHED || open[neighbour] === 0) continue;
          distance[neighbour] = next;
          this.enqueue(next, neighbour);
        }
      }
    }
  }

  /** Start a rewritten `node`'s breadth-first distance: 0 and queued for an open node a hemming point
   *  touches. */
  private seed(node: NodeId): void {
    const hemmed = this.open[node] === 1 && this.hemmed(node);
    this.distance[node] = hemmed ? 0 : UNREACHED;
    if (hemmed) this.enqueue(0, node);
  }

  /** Enter a node of the ring past the rewritten disc at the distance its held class records: below the
   *  cap the two agree, and at the cap it leads nowhere. Not open, it leads nowhere either. */
  private seedFromHeld(node: NodeId): void {
    const held = this.classes[node] ?? 0;
    const leads = this.open[node] === 1 && held < MAX_CLEARANCE_CLASS;
    this.distance[node] = leads ? held : UNREACHED;
    if (leads) this.enqueue(held, node);
  }

  private enqueue(level: number, node: NodeId): void {
    if (level >= MAX_CLEARANCE_CLASS) return;
    const size = this.levelSizes[level] ?? 0;
    const queue = withRoom(this.levels[level] as Int32Array, size);
    this.levels[level] = queue;
    queue[size] = node;
    this.levelSizes[level] = size + 1;
  }

  /** Store `node`'s settled class, counting the water class crossings it makes. */
  private write(node: NodeId): void {
    const d = this.distance[node] ?? UNREACHED;
    const value = this.open[node] === 0 ? 0 : d === UNREACHED ? MAX_CLEARANCE_CLASS : d;
    const held = this.classes[node] ?? 0;
    if (held === value) return;
    this.classes[node] = value;
    this.belowLanes.forEach((lane, logicSize) => {
      lane[node] = value < logicSize ? 1 : 0;
    });
    if (!this.graph.isWater(node)) return;
    for (let k = Math.min(held, value) + 1; k <= Math.max(held, value); k++) {
      this.waterCrossings[k] = (this.waterCrossings[k] ?? 0) + 1;
    }
  }

  /** Whether an open node touches a hemming map point: off the map, not open, or of another component. */
  private hemmed(node: NodeId): boolean {
    if (this.joined[node] !== ALL_JOINED) return true;
    const { open } = this;
    const step = this.steps[Math.floor(node / this.graph.width) & 1] as Int32Array;
    for (let i = 0; i < NEIGHBOURS; i++) {
      if (open[node + (step[i] ?? 0)] === 0) return true;
    }
    return false;
  }

  /**
   * Stamp the in-bounds nodes within {@link SCAN_RADIUS} map-point steps of any of `centres` into
   * {@link disc}, each with its depth from the nearest centre: one breadth-first flood from all centres
   * over the six neighbours, ignoring passability, so a disc rather than a region. Its depths are each
   * node's least distance to a centre, so the nodes within any radius are the union of the per-centre
   * discs of that radius.
   */
  private markDisc(centres: ReadonlySet<NodeId>): void {
    const { graph, discStamps, discDepths } = this;
    if (this.discGeneration >= MAX_DISC_GENERATION) {
      discStamps.fill(0);
      this.discGeneration = 0;
    }
    this.discGeneration += 1;
    const generation = this.discGeneration;
    // A set is already distinct, so every centre takes a slot; `forEach` walks it without an iterator result
    // per entry.
    let size = 0;
    centres.forEach((centre) => {
      discStamps[centre] = generation;
      discDepths[centre] = 0;
      this.disc = withRoom(this.disc, size);
      this.disc[size++] = centre;
    });
    // Discoveries append behind the cursor, so `disc` is its own breadth-first queue.
    for (let at = 0; at < size; at++) {
      const current = (this.disc[at] ?? 0) as NodeId;
      const d = discDepths[current] ?? SCAN_RADIUS;
      if (d >= SCAN_RADIUS) continue;
      const x = graph.xOf(current);
      const y = graph.yOf(current);
      const dxs = neighbourDxOf(y);
      for (let i = 0; i < NEIGHBOURS; i++) {
        const nx = x + (dxs[i] ?? 0);
        const ny = y + (HEX_DY[i] ?? 0);
        if (!graph.inBounds(nx, ny)) continue;
        const neighbour = graph.nodeAt(nx, ny);
        if (discStamps[neighbour] === generation) continue;
        discStamps[neighbour] = generation;
        discDepths[neighbour] = d + 1;
        this.disc = withRoom(this.disc, size);
        this.disc[size++] = neighbour;
      }
    }
    this.discSize = size;
  }
}

/** Each node's neighbour bits: bit i set when its i-th neighbour is on the map and of its component. */
function joinedNeighbours(graph: TerrainGraph): Uint8Array {
  const { width, height } = graph;
  const joined = new Uint8Array(graph.nodeCount);
  for (let y = 0; y < height; y++) {
    const dxs = neighbourDxOf(y);
    for (let x = 0; x < width; x++) {
      const node = graph.nodeAt(x, y);
      const component = graph.componentOf(node);
      let bits = 0;
      for (let i = 0; i < NEIGHBOURS; i++) {
        const nx = x + (dxs[i] ?? 0);
        const ny = y + (HEX_DY[i] ?? 0);
        if (graph.inBounds(nx, ny) && graph.componentOf(graph.nodeAt(nx, ny)) === component) bits |= 1 << i;
      }
      joined[node] = bits;
    }
  }
  return joined;
}
