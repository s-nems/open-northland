import { type Fixed, fx } from '../../core/fixed.js';
import type { BlockLanes, BlockOverlay } from '../block-overlay.js';
import {
  latticeOffsetDistance,
  type NodeId,
  nodeLatticeDistance,
  type TerrainGraph,
} from '../terrain/index.js';
import {
  type ClusterRegions,
  NO_REGION,
  REGION_WEIGHT_SCALE,
  REGIONS_PER_CLUSTER,
} from './cluster-regions.js';
import { findPathWithin, type SearchStats } from './find-path.js';
import { MAX_QUERY_GENERATION } from './scratch.js';

/**
 * Clusters opened to the node search on every side of each cluster the region route crosses. Authored
 * from a replay of two late sessions' walks: with one cluster of margin 96 of 100 long walks keep the
 * map-wide search's route and a long walk costs 0.1% more on average; with none it costs 8% more.
 */
const CORRIDOR_MARGIN_CLUSTERS = 1;

/**
 * The straight lattice distance, in columns, from which a walk takes the corridor search. Authored from
 * the same replay: under it the corridor settles what the map-wide search does and only adds its own cost.
 */
const LONG_WALK_MIN_DISTANCE: Fixed = fx.fromInt(16);

/**
 * Regions the goal-side probe floods before the region search runs. A goal walled into a pocket has few
 * regions, which the probe exhausts, where the search from the start would settle every region of the
 * start's side to learn the same. Authored: above a walled yard's regions, far under a map's.
 */
const GOAL_PROBE_MAX_REGIONS = 64;

/** Regions the search from the start settles before the goal-side probe runs. Authored: a long walk's
 *  region search settles about 20. */
const REGION_SEARCH_PROBE_AFTER = 128;

const NO_PARENT = -1;
const UNCAPPED = Number.POSITIVE_INFINITY;
/** A closed node's byte, the value a block lane holds for a blocked node. */
const OUTSIDE = 1;

/** The mask's blocks inside the open clusters and every node outside them, as one byte lane. */
class CorridorBlocks implements BlockOverlay {
  /** Never empty: the corridor always closes some node. */
  readonly size = 1;
  /** One byte per node: {@link OUTSIDE} except in the clusters a search has open, which hold the mask's
   *  own bytes. */
  readonly bytes: Uint8Array;
  private readonly lanes: BlockLanes;
  constructor(nodeCount: number) {
    this.bytes = new Uint8Array(nodeCount).fill(OUTSIDE);
    this.lanes = { bytes: this.bytes, extra: undefined, players: undefined, hostile: 0 };
  }
  has(node: NodeId): boolean {
    return this.bytes[node] === OUTSIDE;
  }
  blockLanes(): BlockLanes {
    return this.lanes;
  }
}

/**
 * A walk's route in two steps: a search over the cluster regions picks the clusters the walk crosses,
 * then the node search of {@link findPathWithin} runs inside those clusters and their margin only. The
 * region route proves the goal reachable inside the corridor, so the node search settles at most the
 * corridor where the map-wide search floods everything nearer than a detour is long.
 *
 * A route is a pure function of the terrain, the mask and the endpoints: the regions answer as freshly
 * built ones, and nothing else is held between searches.
 */
export class CorridorRoutes {
  private readonly g: Float64Array;
  private readonly parent: Int32Array;
  /** The search that last discovered and last settled each region. */
  private readonly seen: Int32Array;
  private readonly closed: Int32Array;
  private readonly heapF: number[] = [];
  private readonly heapRegion: number[] = [];
  private query = 0;
  private readonly blocks: CorridorBlocks;
  /** The clusters the running search has open, and the search that last opened each cluster. */
  private readonly opened: number[] = [];
  private readonly openedBy: Int32Array;

  constructor(
    private readonly terrain: TerrainGraph,
    readonly regions: ClusterRegions,
  ) {
    const ids = regions.clusterCount * REGIONS_PER_CLUSTER;
    this.g = new Float64Array(ids);
    this.parent = new Int32Array(ids);
    this.seen = new Int32Array(ids);
    this.closed = new Int32Array(ids);
    this.openedBy = new Int32Array(regions.clusterCount);
    this.blocks = new CorridorBlocks(terrain.nodeCount);
  }

  /** {@link find} for a walk long enough to pay for the corridor; null hands a shorter one back too. */
  route(start: NodeId, goal: NodeId, stats: SearchStats): NodeId[] | null {
    if (nodeLatticeDistance(this.terrain, start, goal) < LONG_WALK_MIN_DISTANCE) return null;
    return this.find(start, goal, stats);
  }

  /**
   * A land route from `start` to `goal` under the regions' mask, or null when the corridor gives none: an
   * endpoint outside every region (a blocked start stepping off, a blocked goal) or no chain of regions
   * between them. Null is no verdict on reachability; the caller searches the whole map. `stats` is
   * charged the regions and the nodes settled.
   */
  find(start: NodeId, goal: NodeId, stats: SearchStats): NodeId[] | null {
    const { regions } = this;
    regions.refresh();
    const from = regions.regionOf(start);
    const to = regions.regionOf(goal);
    if (from === NO_REGION || to === NO_REGION || !this.chainRegions(from, to, goal, stats)) return null;
    this.openCorridor(to);
    const path = findPathWithin(this.terrain, start, goal, this.blocks, stats, UNCAPPED);
    this.closeCorridor();
    return typeof path === 'string' ? null : path;
  }

  /**
   * The region search, probing the goal's side once the search outruns an ordinary one: a goal walled into
   * a pocket is then refused at the pocket's size instead of the start side's.
   */
  private chainRegions(from: number, to: number, goal: NodeId, stats: SearchStats): boolean {
    const near = this.searchRegions(from, to, goal, stats, REGION_SEARCH_PROBE_AFTER);
    if (near !== undefined) return near;
    if (!this.goalSideReaches(to, from, stats)) return false;
    return this.searchRegions(from, to, goal, stats, UNCAPPED) === true;
  }

  /**
   * Whether a flood over the regions back from `to` meets `from` or outgrows
   * {@link GOAL_PROBE_MAX_REGIONS}; false proves no chain of regions joins the two, since links run both
   * ways.
   */
  private goalSideReaches(to: number, from: number, stats: SearchStats): boolean {
    const { regions, seen, heapRegion } = this;
    this.nextQuery();
    const query = this.query;
    heapRegion.length = 0;
    heapRegion.push(to);
    seen[to] = query;
    for (let head = 0; head < heapRegion.length; head++) {
      const current = heapRegion[head] ?? 0;
      if (current === from || heapRegion.length > GOAL_PROBE_MAX_REGIONS) return true;
      stats.explored += 1;
      const links = regions.linksOf(current);
      for (let i = 0; i < links.length; i++) {
        const next = links[i] ?? 0;
        if (seen[next] === query) continue;
        seen[next] = query;
        heapRegion.push(next);
      }
    }
    return false;
  }

  private nextQuery(): void {
    if (this.query >= MAX_QUERY_GENERATION) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.openedBy.fill(0);
      this.query = 0;
    }
    this.query += 1;
  }

  /**
   * A* over the regions from `from` to `to`, leaving the route in {@link parent}; undefined once it has
   * settled `maxSettled` regions with no verdict. A step between two
   * regions costs the lattice distance between their mean nodes, weighed by the mean of their weights.
   * Approximation: it only has to rank corridors, and the node search prices the route itself.
   */
  private searchRegions(
    from: number,
    to: number,
    goal: NodeId,
    stats: SearchStats,
    maxSettled: number,
  ): boolean | undefined {
    const { regions, g, parent, seen, closed, heapF, heapRegion, terrain } = this;
    this.nextQuery();
    const query = this.query;
    const goalY = terrain.yOf(goal);
    const goalX = goal - goalY * terrain.width;
    heapF.length = 0;
    heapRegion.length = 0;
    seen[from] = query;
    g[from] = 0;
    parent[from] = NO_PARENT;
    push(heapF, heapRegion, 0, from);
    let settled = 0;
    while (heapRegion.length > 0) {
      const current = heapRegion[0] ?? 0;
      pop(heapF, heapRegion);
      // A region relaxed after it was pushed waits in the heap twice; its dearer entry is skipped here.
      if (closed[current] === query) continue;
      if (settled >= maxSettled) return undefined;
      settled += 1;
      closed[current] = query;
      stats.explored += 1;
      if (current === to) return true;
      const x = regions.centreXOf(current);
      const y = regions.centreYOf(current);
      const currentWeight = regions.weightOf(current);
      const currentG = g[current] ?? 0;
      const links = regions.linksOf(current);
      for (let i = 0; i < links.length; i++) {
        const next = links[i] ?? 0;
        if (closed[next] === query) continue;
        const nextX = regions.centreXOf(next);
        const nextY = regions.centreYOf(next);
        const length = latticeOffsetDistance(nextX - x, nextY - y, y);
        const weight = currentWeight + regions.weightOf(next);
        const tentative = currentG + Math.floor((length * weight) / (2 * REGION_WEIGHT_SCALE));
        if (seen[next] === query && tentative >= (g[next] ?? 0)) continue;
        seen[next] = query;
        g[next] = tentative;
        parent[next] = current;
        // No step weighs under one, so the plain lattice distance never overestimates.
        push(heapF, heapRegion, tentative + latticeOffsetDistance(goalX - nextX, goalY - nextY, nextY), next);
      }
    }
    return false;
  }

  /** Open the clusters within the margin of the region route ending at `to`. */
  private openCorridor(to: number): void {
    const { regions, parent, opened, openedBy, query } = this;
    const lanes = regions.mask.blockLanes();
    if (lanes.extra !== undefined || lanes.players !== undefined) {
      throw new Error('the corridor reads a mask whose blocks are all in its byte lane');
    }
    const bytes = this.blocks.bytes;
    for (let region = to; region !== NO_PARENT; region = parent[region] ?? NO_PARENT) {
      const cluster = Math.floor(region / REGIONS_PER_CLUSTER);
      const column = cluster % regions.columns;
      const row = Math.floor(cluster / regions.columns);
      const lastRow = Math.min(regions.rows - 1, row + CORRIDOR_MARGIN_CLUSTERS);
      const lastColumn = Math.min(regions.columns - 1, column + CORRIDOR_MARGIN_CLUSTERS);
      for (let r = Math.max(0, row - CORRIDOR_MARGIN_CLUSTERS); r <= lastRow; r++) {
        for (let c = Math.max(0, column - CORRIDOR_MARGIN_CLUSTERS); c <= lastColumn; c++) {
          const near = r * regions.columns + c;
          if (openedBy[near] === query) continue;
          openedBy[near] = query;
          opened.push(near);
          regions.copyCluster(lanes.bytes, bytes, near);
        }
      }
    }
  }

  private closeCorridor(): void {
    const bytes = this.blocks.bytes;
    for (const cluster of this.opened) this.regions.fillCluster(bytes, cluster, OUTSIDE);
    this.opened.length = 0;
  }
}

/** Whether heap entry `(fa, a)` orders before `(fb, b)`: by key, then by region id, a total order. */
function before(fa: number, a: number, fb: number, b: number): boolean {
  return fa < fb || (fa === fb && a < b);
}

function push(heapF: number[], heapRegion: number[], f: number, region: number): void {
  let i = heapRegion.length;
  heapF.push(f);
  heapRegion.push(region);
  while (i > 0) {
    const up = (i - 1) >> 1;
    const upF = heapF[up] ?? 0;
    const upRegion = heapRegion[up] ?? 0;
    if (!before(f, region, upF, upRegion)) break;
    heapF[i] = upF;
    heapRegion[i] = upRegion;
    i = up;
  }
  heapF[i] = f;
  heapRegion[i] = region;
}

function pop(heapF: number[], heapRegion: number[]): void {
  const f = heapF.pop() ?? 0;
  const region = heapRegion.pop() ?? 0;
  const size = heapRegion.length;
  if (size === 0) return;
  let i = 0;
  for (;;) {
    let child = 2 * i + 1;
    if (child >= size) break;
    const right = child + 1;
    if (
      right < size &&
      before(heapF[right] ?? 0, heapRegion[right] ?? 0, heapF[child] ?? 0, heapRegion[child] ?? 0)
    ) {
      child = right;
    }
    const childF = heapF[child] ?? 0;
    const childRegion = heapRegion[child] ?? 0;
    if (!before(childF, childRegion, f, region)) break;
    heapF[i] = childF;
    heapRegion[i] = childRegion;
    i = child;
  }
  heapF[i] = f;
  heapRegion[i] = region;
}
