import type { BlockLanes, BlockOverlay } from '../block-overlay.js';
import type { NodeArea } from '../halfcell.js';
import { NO_READMITTED, type NodeId, STEP_ROWS, StepGate, type TerrainGraph } from '../terrain/index.js';

/**
 * Nodes per cluster side. Authored: the block size of the walk-block flip stamps, so a cluster's
 * staleness check reads one stamp block.
 */
export const CLUSTER_SIZE = 16;

/** Region ids a cluster owns: its regions are numbered from 1, and 0 is no region. */
export const REGIONS_PER_CLUSTER = 256;

/** {@link ClusterRegions.regionOf} of a node no land walker stands on, or of one in a cluster too
 *  fragmented to label. */
export const NO_REGION = -1;

/** A region's weight is held in this many parts per whole route factor. */
export const REGION_WEIGHT_SCALE = 256;

/**
 * The share of a region's nodes its weight averages, cheapest first: a route crossing the region keeps to
 * its road or its easiest ground, which the mean over every node hides. Authored from a replay of two
 * late sessions' walks: a quarter picked cheaper corridors than the whole, an eighth no better ones.
 */
const REGION_WEIGHT_CHEAPEST_SHARE = 4;

/** Route factors a node's byte lane holds. */
const ROUTE_FACTORS = 256;

const MAX_REGIONS = REGIONS_PER_CLUSTER - 1;
const UNBUILT = 0;
const LABELLED = 1;
/** A cluster with more than {@link MAX_REGIONS} regions holds none, so a search through it falls back. */
const FRAGMENTED = 2;
const EDGE_COUNT = STEP_ROWS.length;
const NO_LINKS: readonly number[] = [];

/** The mean route factor of the cheapest {@link REGION_WEIGHT_CHEAPEST_SHARE}th of `size` nodes counted by
 *  factor in `counts`, in {@link REGION_WEIGHT_SCALE} parts. */
function cheapestShareWeight(counts: Int32Array, size: number): number {
  const share = Math.ceil(size / REGION_WEIGHT_CHEAPEST_SHARE);
  let left = share;
  let sum = 0;
  for (let factor = 0; left > 0 && factor < counts.length; factor++) {
    const taken = Math.min(left, counts[factor] ?? 0);
    sum += taken * factor;
    left -= taken;
  }
  return Math.floor((sum * REGION_WEIGHT_SCALE) / share);
}

/** A walk-block overlay that stamps its flips and holds every block in its byte lane, as the structure
 *  mask does. */
export interface FlipStampedBlocks extends BlockOverlay {
  blockLanes(): BlockLanes;
  /** The clock {@link flippedSince} reads: it advances with every flip. */
  readonly version: number;
  flippedSince(area: NodeArea, since: number, test: (x: number, y: number) => boolean): boolean;
}

function anyNode(): boolean {
  return true;
}

/**
 * The land lattice under a walk-block mask cut into square clusters, each split into its regions: the
 * sets of open nodes joined by steps that stay inside the cluster. Two nodes are joined by a walk exactly
 * when a chain of linked regions joins theirs, so the regions are the map's connectivity at a sixteenth
 * of its scale.
 *
 * A derived cache: a cluster is labelled on the first ask and again once one of its nodes flipped on the
 * mask or changed resistance, and labels, centres, weights and links are pure functions of the terrain
 * and the mask, so a held cluster answers as a freshly built one.
 */
export class ClusterRegions {
  readonly columns: number;
  readonly rows: number;
  /** Each node's region number within its cluster, 0 for none. */
  private readonly labels: Uint8Array;
  private readonly state: Uint8Array;
  private readonly regionCounts: Uint16Array;
  /** The mask version and resistance clock each cluster was labelled at. */
  private readonly builtMask: Float64Array;
  private readonly builtResistance: Float64Array;
  /** The {@link epoch} each cluster was last found current in. */
  private readonly checked: Int32Array;
  /** The {@link builds} count at each cluster's last labelling, and at its links' last listing. */
  private readonly labelledAt: Float64Array;
  private readonly linkedAt: Float64Array;
  /** Per region id: the mean node of the region, and its weight in {@link REGION_WEIGHT_SCALE}
   *  parts. */
  private readonly centreX: Int16Array;
  private readonly centreY: Int16Array;
  private readonly weights: Uint16Array;
  /** Per cluster, by region number: the region ids of other clusters a step leads into. */
  private readonly links: (number[][] | undefined)[];
  private readonly areas: (NodeArea | undefined)[];
  private readonly gate = new StepGate();
  private readonly queue = new Int32Array(CLUSTER_SIZE * CLUSTER_SIZE);
  /** Scratch: the nodes of the region being labelled, counted by route factor. */
  private readonly factorCounts = new Int32Array(ROUTE_FACTORS);
  private epoch = 0;
  private builds = 0;
  private seenMask = Number.NaN;
  private seenResistance = Number.NaN;

  constructor(
    readonly terrain: TerrainGraph,
    readonly mask: FlipStampedBlocks,
  ) {
    this.columns = Math.ceil(terrain.width / CLUSTER_SIZE);
    this.rows = Math.ceil(terrain.height / CLUSTER_SIZE);
    const clusters = this.columns * this.rows;
    this.labels = new Uint8Array(terrain.nodeCount);
    this.state = new Uint8Array(clusters);
    this.regionCounts = new Uint16Array(clusters);
    this.builtMask = new Float64Array(clusters);
    this.builtResistance = new Float64Array(clusters);
    this.checked = new Int32Array(clusters);
    this.labelledAt = new Float64Array(clusters);
    this.linkedAt = new Float64Array(clusters);
    this.centreX = new Int16Array(clusters * REGIONS_PER_CLUSTER);
    this.centreY = new Int16Array(clusters * REGIONS_PER_CLUSTER);
    this.weights = new Uint16Array(clusters * REGIONS_PER_CLUSTER);
    this.links = new Array<number[][] | undefined>(clusters).fill(undefined);
    this.areas = new Array<NodeArea | undefined>(clusters).fill(undefined);
  }

  get clusterCount(): number {
    return this.state.length;
  }

  /** Write `value` over every node of `cluster` in a per-node `lane`. */
  fillCluster(lane: Uint8Array, cluster: number, value: number): void {
    const { minHx, minHy, maxHx, maxHy } = this.areaOf(cluster);
    const width = this.terrain.width;
    for (let y = minHy; y <= maxHy; y++) lane.fill(value, y * width + minHx, y * width + maxHx + 1);
  }

  /** Copy every node of `cluster` from one per-node lane into another. */
  copyCluster(from: Uint8Array, into: Uint8Array, cluster: number): void {
    const { minHx, minHy, maxHx, maxHy } = this.areaOf(cluster);
    const width = this.terrain.width;
    for (let y = minHy; y <= maxHy; y++) {
      const end = y * width + maxHx;
      for (let node = y * width + minHx; node <= end; node++) into[node] = from[node] ?? 0;
    }
  }

  /** Call before a batch of reads: later reads see the mask and the roads as they stand now. */
  refresh(): void {
    const mask = this.mask.version;
    const resistance = this.terrain.resistanceClock;
    if (mask !== this.seenMask || resistance !== this.seenResistance) {
      this.seenMask = mask;
      this.seenResistance = resistance;
      this.epoch += 1;
    }
    this.terrain.resetGate(this.gate, 'land', this.mask, NO_READMITTED);
  }

  clusterOf(node: NodeId): number {
    const y = this.terrain.yOf(node);
    const x = node - y * this.terrain.width;
    return Math.floor(y / CLUSTER_SIZE) * this.columns + Math.floor(x / CLUSTER_SIZE);
  }

  /** The region holding `node`, or {@link NO_REGION}. */
  regionOf(node: NodeId): number {
    const cluster = this.clusterOf(node);
    this.level(cluster);
    const label = this.labels[node] ?? 0;
    return label === 0 ? NO_REGION : cluster * REGIONS_PER_CLUSTER + label;
  }

  centreXOf(region: number): number {
    return this.centreX[region] ?? 0;
  }

  centreYOf(region: number): number {
    return this.centreY[region] ?? 0;
  }

  /** The route factor a walk across the region meets, in {@link REGION_WEIGHT_SCALE} parts. */
  weightOf(region: number): number {
    return this.weights[region] ?? 0;
  }

  /** The regions of other clusters a step out of `region` enters, in a fixed order. */
  linksOf(region: number): readonly number[] {
    const cluster = Math.floor(region / REGIONS_PER_CLUSTER);
    const column = cluster % this.columns;
    const row = Math.floor(cluster / this.columns);
    let latest = 0;
    for (let r = Math.max(0, row - 1); r <= Math.min(this.rows - 1, row + 1); r++) {
      for (let c = Math.max(0, column - 1); c <= Math.min(this.columns - 1, column + 1); c++) {
        const near = r * this.columns + c;
        this.level(near);
        const at = this.labelledAt[near] ?? 0;
        if (at > latest) latest = at;
      }
    }
    let links = this.links[cluster];
    if (links === undefined || (this.linkedAt[cluster] ?? 0) < latest) {
      links = this.listLinks(cluster);
      this.links[cluster] = links;
      this.linkedAt[cluster] = this.builds;
    }
    return links[region % REGIONS_PER_CLUSTER] ?? NO_LINKS;
  }

  private areaOf(cluster: number): NodeArea {
    const held = this.areas[cluster];
    if (held !== undefined) return held;
    const area = this.boxOf(cluster);
    this.areas[cluster] = area;
    return area;
  }

  private boxOf(cluster: number): NodeArea {
    const minHx = (cluster % this.columns) * CLUSTER_SIZE;
    const minHy = Math.floor(cluster / this.columns) * CLUSTER_SIZE;
    return {
      minHx,
      minHy,
      maxHx: Math.min(this.terrain.width, minHx + CLUSTER_SIZE) - 1,
      maxHy: Math.min(this.terrain.height, minHy + CLUSTER_SIZE) - 1,
    };
  }

  /** Whether `cluster`'s held labels are those a fresh labelling would give. */
  private current(cluster: number, area: NodeArea): boolean {
    return (
      this.state[cluster] !== UNBUILT &&
      !this.mask.flippedSince(area, this.builtMask[cluster] ?? 0, anyNode) &&
      !this.terrain.resistanceChangedSince(area, this.builtResistance[cluster] ?? 0, anyNode)
    );
  }

  private level(cluster: number): void {
    if (this.checked[cluster] === this.epoch && this.state[cluster] !== UNBUILT) return;
    const area = this.areaOf(cluster);
    if (!this.current(cluster, area)) {
      this.builds += 1;
      this.labelledAt[cluster] = this.builds;
      this.builtMask[cluster] = this.seenMask;
      this.builtResistance[cluster] = this.seenResistance;
      const regions = this.label(
        area,
        cluster * REGIONS_PER_CLUSTER,
        this.labels,
        this.centreX,
        this.centreY,
        this.weights,
      );
      this.state[cluster] = regions === NO_REGION ? FRAGMENTED : LABELLED;
      this.regionCounts[cluster] = regions === NO_REGION ? 0 : regions;
    }
    this.checked[cluster] = this.epoch;
  }

  /**
   * Number the regions of `area` from 1 in row-major order of their first node, into `labels` per node and
   * the three lanes from `base`. Returns the region count, or {@link NO_REGION} with every label cleared
   * when the cluster holds more than {@link MAX_REGIONS}.
   */
  private label(
    area: NodeArea,
    base: number,
    labels: Uint8Array,
    centreX: Int16Array,
    centreY: Int16Array,
    weights: Uint16Array,
  ): number {
    const { terrain, gate, queue, factorCounts } = this;
    const { minHx, minHy, maxHx, maxHy } = area;
    const width = terrain.width;
    const lane = gate.lane;
    const factors = terrain.routeFactorLane('land');
    for (let y = minHy; y <= maxHy; y++) labels.fill(0, y * width + minHx, y * width + maxHx + 1);
    let regions = 0;
    for (let y = minHy; y <= maxHy; y++) {
      for (let x = minHx; x <= maxHx; x++) {
        const seed = (y * width + x) as NodeId;
        if (labels[seed] !== 0 || !terrain.traversable(seed, 'land') || gate.closes(seed)) continue;
        if (regions === MAX_REGIONS) {
          for (let row = minHy; row <= maxHy; row++) {
            labels.fill(0, row * width + minHx, row * width + maxHx + 1);
          }
          return NO_REGION;
        }
        regions += 1;
        labels[seed] = regions;
        queue[0] = seed;
        let size = 1;
        let sumX = 0;
        let sumY = 0;
        factorCounts.fill(0);
        for (let head = 0; head < size; head++) {
          const node = queue[head] ?? 0;
          const nodeY = Math.floor(node / width);
          sumX += node - nodeY * width;
          sumY += nodeY;
          const factor = factors?.[node] ?? 1;
          factorCounts[factor] = (factorCounts[factor] ?? 0) + 1;
          const open = lane[node] ?? 0;
          const offsets = terrain.stepOffsets(nodeY);
          for (let edge = 0; edge < EDGE_COUNT; edge++) {
            if ((open & (1 << edge)) === 0) continue;
            const next = node + (offsets[edge] ?? 0);
            const nextY = nodeY + (STEP_ROWS[edge] ?? 0);
            const nextX = next - nextY * width;
            if (nextX < minHx || nextX > maxHx || nextY < minHy || nextY > maxHy) continue;
            if (labels[next] !== 0 || gate.closes(next)) continue;
            labels[next] = regions;
            queue[size] = next;
            size += 1;
          }
        }
        centreX[base + regions] = Math.floor(sumX / size);
        centreY[base + regions] = Math.floor(sumY / size);
        weights[base + regions] = cheapestShareWeight(factorCounts, size);
      }
    }
    return regions;
  }

  /** Each region of `cluster`'s links, read off the steps its border nodes take out of the cluster. The
   *  eight clusters round it must be level. */
  private listLinks(cluster: number): number[][] {
    const { terrain, gate, labels } = this;
    const { minHx, minHy, maxHx, maxHy } = this.areaOf(cluster);
    const width = terrain.width;
    const lane = gate.lane;
    const links: number[][] = [];
    for (let y = minHy; y <= maxHy; y++) {
      const inner = y !== minHy && y !== maxHy;
      const offsets = terrain.stepOffsets(y);
      // An inner row leaves the cluster only from its two end nodes.
      const stride = inner && maxHx > minHx ? maxHx - minHx : 1;
      for (let x = minHx; x <= maxHx; x += stride) {
        const node = y * width + x;
        const label = labels[node] ?? 0;
        if (label === 0) continue;
        const open = lane[node] ?? 0;
        for (let edge = 0; edge < EDGE_COUNT; edge++) {
          if ((open & (1 << edge)) === 0) continue;
          const next = node + (offsets[edge] ?? 0);
          const nextY = y + (STEP_ROWS[edge] ?? 0);
          const nextX = next - nextY * width;
          if (nextX >= minHx && nextX <= maxHx && nextY >= minHy && nextY <= maxHy) continue;
          const nextLabel = labels[next] ?? 0;
          if (nextLabel === 0) continue;
          const region =
            (Math.floor(nextY / CLUSTER_SIZE) * this.columns + Math.floor(nextX / CLUSTER_SIZE)) *
              REGIONS_PER_CLUSTER +
            nextLabel;
          let list = links[label];
          if (list === undefined) {
            list = [];
            links[label] = list;
          }
          if (!list.includes(region)) list.push(region);
        }
      }
    }
    return links;
  }

  /**
   * Every held cluster the staleness check would still serve must match a fresh labelling, and its held
   * links a fresh listing: a mismatch means a change reached the search unstamped.
   */
  verify(): string[] {
    this.refresh();
    const clusters = this.state.length;
    const scratchLabels = new Uint8Array(this.terrain.nodeCount);
    const centreX = new Int16Array(REGIONS_PER_CLUSTER);
    const centreY = new Int16Array(REGIONS_PER_CLUSTER);
    const weights = new Uint16Array(REGIONS_PER_CLUSTER);
    const width = this.terrain.width;
    const served: boolean[] = [];
    let stale = 0;
    for (let cluster = 0; cluster < clusters; cluster++) {
      const area = this.areaOf(cluster);
      served[cluster] = this.current(cluster, area);
      if (!served[cluster]) continue;
      const fresh = this.label(area, 0, scratchLabels, centreX, centreY, weights);
      const base = cluster * REGIONS_PER_CLUSTER;
      let same =
        (fresh === NO_REGION) === (this.state[cluster] === FRAGMENTED) &&
        (fresh === NO_REGION ? 0 : fresh) === this.regionCounts[cluster];
      for (let y = area.minHy; same && y <= area.maxHy; y++) {
        for (let x = area.minHx; x <= area.maxHx; x++) {
          if (scratchLabels[y * width + x] !== this.labels[y * width + x]) same = false;
        }
      }
      for (let label = 1; same && label <= (this.regionCounts[cluster] ?? 0); label++) {
        same =
          centreX[label] === this.centreX[base + label] &&
          centreY[label] === this.centreY[base + label] &&
          weights[label] === this.weights[base + label];
      }
      if (!same) stale += 1;
    }
    let staleLinks = 0;
    for (let cluster = 0; stale === 0 && cluster < clusters; cluster++) {
      const held = this.links[cluster];
      if (held === undefined || !this.linksServed(cluster, served)) continue;
      const fresh = this.listLinks(cluster);
      for (let label = 1; label <= (this.regionCounts[cluster] ?? 0); label++) {
        const a = held[label] ?? NO_LINKS;
        const b = fresh[label] ?? NO_LINKS;
        if (a.length !== b.length || a.some((region, i) => region !== b[i])) {
          staleLinks += 1;
          break;
        }
      }
    }
    const problems: string[] = [];
    if (stale > 0) problems.push(`clusterRegions holds ${stale} clusters a fresh labelling disagrees with`);
    if (staleLinks > 0) problems.push(`clusterRegions holds ${staleLinks} clusters with stale links`);
    return problems;
  }

  /** Whether {@link linksOf} would hand out `cluster`'s held links without listing them again. */
  private linksServed(cluster: number, served: readonly boolean[]): boolean {
    const column = cluster % this.columns;
    const row = Math.floor(cluster / this.columns);
    for (let r = Math.max(0, row - 1); r <= Math.min(this.rows - 1, row + 1); r++) {
      for (let c = Math.max(0, column - 1); c <= Math.min(this.columns - 1, column + 1); c++) {
        const near = r * this.columns + c;
        if (served[near] !== true || (this.labelledAt[near] ?? 0) > (this.linkedAt[cluster] ?? 0))
          return false;
      }
    }
    return true;
  }
}
