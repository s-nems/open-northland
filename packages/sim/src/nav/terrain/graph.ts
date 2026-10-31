import { type Fixed, fx, ONE } from '../../core/fixed.js';
import { NodeChangeStamps } from '../change-stamps.js';
import { cellOfNode, type NodeArea } from '../halfcell.js';
import { TerrainEdges } from './edges.js';
import type { LandscapeProps } from './landscape-props.js';
import type { LandscapeMapInput } from './landscapes.js';
import type { Traversal } from './lattice.js';
import type { NodeId } from './node-id.js';
import { NO_NEAREST_ROAD, NO_ROAD_DISTANCE, RoadDistanceField } from './road-distance.js';
import { NO_ROAD_NETWORK, RoadNetworks } from './road-networks.js';
import { StepBuffer } from './step-buffer.js';

/** The two mover classes in the order their continents are labelled. */
const TRAVERSALS: readonly Traversal[] = ['land', 'water'];

/**
 * The roughness every land node of a map without an `lmpr` lane reads: the owned corpus's `land` value
 * (`trianglepatterntypes` land = 2, the ground most of a map is). A decoded map always carries its lane;
 * this only paces synthetic and scene terrain.
 */
export const DEFAULT_NODE_ROUGHNESS = 2;

/** The roughness a water node of such a map reads: the owned corpus's open-water value (nine in ten
 *  all-water cells read 1). */
export const DEFAULT_WATER_ROUGHNESS = 1;

/** The {@link TerrainGraph.componentOf} label of a node no mover class enters. */
export const NO_COMPONENT = -1;

/** The `vertexcolors` palette entry of a cell no author or script ever tinted. */
const NEUTRAL_TINT = 0;

/**
 * The walking resistance of a road node, whatever ground lies under it. Original behavior: a road
 * rewrites the node's resistance, which every reader of the value then sees (step pace, shoe wear, a
 * vehicle's ground class, the route search), and every authored `lmro` road node holds 1 in `lmpr`.
 */
export const ROAD_RESISTANCE = 1;

/**
 * The least resistance a land route step is weighed by. `lmpr` 0 marks the map border and a few void
 * nodes, which the original's search enters for free; they weigh as a road instead, so unweighted
 * lattice distance stays a lower bound on any route's cost. Approximation.
 */
const MIN_ROUTE_RESISTANCE = ROAD_RESISTANCE;

/** Resistance values a node's Uint8 resistance lanes can hold. */
const RESISTANCE_VALUES = 2 ** 8;

/** The integer factor a land route step onto ground of `resistance` is weighed by. */
function routeFactorOf(resistance: number): number {
  return resistance < MIN_ROUTE_RESISTANCE ? MIN_ROUTE_RESISTANCE : resistance;
}

/** Each route factor's weight as a Fixed, so a reader turns the byte lane into a weight by lookup. */
const ROUTE_WEIGHT_BY_FACTOR: readonly Fixed[] = Array.from({ length: RESISTANCE_VALUES }, (_, factor) =>
  fx.fromInt(factor),
);

/** The widest value each unsigned typed lane holds, narrowest first. */
const UINT8_MAX = 2 ** 8 - 1;
const UINT16_MAX = 2 ** 16 - 1;
const UINT32_MAX = 2 ** 32 - 1;

/**
 * `values` in the narrowest unsigned typed array that holds every one exactly, or `values` itself when
 * one is negative or fractional. A decoded lane holds non-negative integers, a byte or two each, where a
 * JS array spends a full slot on every one.
 */
export function compactLane(values: ArrayLike<number>): ArrayLike<number> {
  let max = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? -1;
    if (!Number.isInteger(v) || v < 0 || v > UINT32_MAX) return values;
    if (v > max) max = v;
  }
  if (max <= UINT8_MAX) return Uint8Array.from(values);
  if (max <= UINT16_MAX) return Uint16Array.from(values);
  return Uint32Array.from(values);
}

/** The road revision of a graph no road network has been mirrored into yet; world revisions start at 0. */
const UNSYNCED_ROAD_REVISION = -1;

/** The half-cell box holding every node of one static component. */
export interface ComponentBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * The sim's navigation model: the half-cell node lattice with its six-edge adjacency and each node's
 * static connectivity label. Distinct from the render's triangle tessellation. Construct through
 * {@link buildTerrainGraph}.
 */
export class TerrainGraph extends TerrainEdges {
  private readonly components: Int32Array;
  /** The original `lmco` continent id per node, the authored key fish swarms are matched on; the
   *  movers compare {@link componentOf} instead. */
  readonly waterContinents: ArrayLike<number> | undefined;
  /** Original cell-resolution elevation lane, row-major over {@link cellColumns}. */
  private readonly elevation: ArrayLike<number> | undefined;
  /** Indexed by component label; built on the first ask, since the components never change. */
  private componentBoxes: readonly ComponentBox[] | null = null;
  /** Per-node `lmpr` roughness, or undefined for the uniform default. */
  private readonly roughness: Uint8Array | undefined;
  /** The map author's vertex colour palette index per cell, row-major over {@link cellColumns};
   *  absent, every cell reads neutral. */
  private readonly authoredTints: Uint8Array | undefined;
  /** Cells per map row: the vertex colour lanes' row stride. */
  readonly cellColumns: number;
  readonly cellRows: number;
  /** Per-node road flag, the world's road network mirrored by {@link syncRoads}. */
  private readonly roads: Uint8Array;
  private roadNodes: NodeId[] = [];
  private roadRevision = UNSYNCED_ROAD_REVISION;
  /** Per-node lattice distance to the nearest road and that road, allocated with the first road. */
  private roadDistances: RoadDistanceField | undefined;
  /** The connected road networks, allocated with the first road. */
  private roadNetworks: RoadNetworks | undefined;
  /** Per-node {@link routeFactorOf} the land route search weighs a step onto the node by. */
  private readonly routeFactors: Uint8Array;
  /** Per-node {@link resistanceAt} on walkable ground and 0 where a walker never stands, the one read a
   *  range search makes per inspected node. */
  private readonly entryResistances: Uint8Array;
  /** Each node's latest {@link walkableResistances} change, stamped with {@link resistanceClock}. */
  private readonly resistanceStamps: NodeChangeStamps;
  private resistanceChanges = 0;

  constructor(
    width: number,
    height: number,
    typeIds: Int32Array,
    props: ReadonlyMap<number, LandscapeProps>,
    readonly landscapes?: LandscapeMapInput,
    groundKinds?: readonly number[],
    waterContinents?: readonly number[],
    roughness?: readonly number[],
    elevation?: readonly number[],
    tints?: readonly number[],
    groundEdges?: ArrayLike<number>,
  ) {
    super(width, height, typeIds, props, groundKinds, groundEdges);
    if (waterContinents !== undefined && waterContinents.length !== this.nodeCount) {
      throw new Error(`water continent lane has ${waterContinents.length} nodes, expected ${this.nodeCount}`);
    }
    if (roughness !== undefined && roughness.length !== this.nodeCount) {
      throw new Error(`roughness lane has ${roughness.length} nodes, expected ${this.nodeCount}`);
    }
    this.waterContinents = waterContinents === undefined ? undefined : compactLane(waterContinents);
    this.roughness = roughness === undefined ? undefined : Uint8Array.from(roughness);
    this.roads = new Uint8Array(this.nodeCount);
    this.routeFactors = new Uint8Array(this.nodeCount);
    this.entryResistances = new Uint8Array(this.nodeCount);
    this.resistanceStamps = new NodeChangeStamps(width, height);
    for (let i = 0; i < this.nodeCount; i++) {
      const node = i as NodeId;
      this.routeFactors[node] = routeFactorOf(this.roughnessAt(node));
      this.entryResistances[node] = this.isWalkable(node) ? this.roughnessAt(node) : 0;
    }
    this.cellColumns = Math.ceil(width / 2);
    this.cellRows = Math.ceil(height / 2);
    const cellCount = this.cellColumns * this.cellRows;
    if (elevation !== undefined && elevation.length !== cellCount) {
      throw new Error(`elevation lane has ${elevation.length} cells, expected ${cellCount}`);
    }
    if (tints !== undefined && tints.length !== cellCount) {
      throw new Error(`vertex colour lane has ${tints.length} cells, expected ${cellCount}`);
    }
    this.authoredTints = tints === undefined ? undefined : Uint8Array.from(tints);
    this.elevation = elevation === undefined ? undefined : compactLane(elevation);
    this.components = this.computeComponents();
  }

  /** The author's vertex colour palette index of cell `cy * cellColumns + cx`, 0 for one never tinted. */
  authoredTintOfCell(cell: number): number {
    return this.authoredTints?.[cell] ?? NEUTRAL_TINT;
  }

  /** Writes every cell's authored tint into `out` (one byte per cell), neutral without a lane. */
  copyAuthoredTints(out: Uint8Array): void {
    if (this.authoredTints !== undefined) out.set(this.authoredTints);
    else out.fill(NEUTRAL_TINT);
  }

  /** The map's own `lmpr` roughness at `node` (0..5 on the owned corpus), ignoring roads laid since;
   *  gameplay reads {@link resistanceAt}. Throws on an id outside the grid. */
  roughnessAt(node: NodeId): number {
    if (node < 0 || node >= this.nodeCount) {
      throw new Error(`node id ${node} out of range (0..${this.nodeCount - 1})`);
    }
    if (this.roughness !== undefined) return this.roughness[node] ?? DEFAULT_NODE_ROUGHNESS;
    return this.isWater(node) ? DEFAULT_WATER_ROUGHNESS : DEFAULT_NODE_ROUGHNESS;
  }

  /** The walking resistance of `node` with roads: what a settler's step pace, shoe wear and hunger and a
   *  vehicle's move period (its ground speed class) read off the node it leaves (original behavior).
   *  Throws on an id outside the grid. */
  resistanceAt(node: NodeId): number {
    return this.isRoad(node) ? ROAD_RESISTANCE : this.roughnessAt(node);
  }

  /** {@link resistanceAt} per row-major node id where {@link isWalkable} holds, 0 elsewhere: a scan's
   *  bounds-checked read. Kept current by every road change; callers must not write it. */
  walkableResistances(): Uint8Array {
    return this.entryResistances;
  }

  /** A count of {@link walkableResistances} changes, for {@link resistanceChangedSince}. */
  get resistanceClock(): number {
    return this.resistanceChanges;
  }

  /** Whether a node of `area` changed its {@link walkableResistances} entry after clock reading `since`
   *  and passes `test`. */
  resistanceChangedSince(area: NodeArea, since: number, test: (x: number, y: number) => boolean): boolean {
    return this.resistanceStamps.anyChangedSince(area, since, test);
  }

  /** Whether a road runs over `node`. Throws on an id outside the grid. */
  isRoad(node: NodeId): boolean {
    return this.checkedSlot(this.roads, node) !== 0;
  }

  /** The obstacle-free lattice distance from `node` to the nearest road in column units, or
   *  {@link NO_ROAD_DISTANCE} on a map without roads; for a node the caller has bounds-checked. */
  roadDistanceAt(node: NodeId): Fixed {
    // The lane stores Fixed values; a typed array only drops the brand.
    return (this.roadDistances?.distances[node] ?? NO_ROAD_DISTANCE) as Fixed;
  }

  /** The label of the connected road network holding the road nearest `node`, or
   *  {@link NO_ROAD_NETWORK} past every road's reach; for a node the caller has bounds-checked. Two
   *  labels read before the next road change are equal exactly when their roads connect. */
  roadNetworkNear(node: NodeId): number {
    const road = this.roadDistances?.nearest[node] ?? NO_NEAREST_ROAD;
    if (road === NO_NEAREST_ROAD || this.roadNetworks === undefined) return NO_ROAD_NETWORK;
    return this.roadNetworks.networkOf(road);
  }

  /** The lattice distance from `(x, y)` to the bounding box of road network `network`, a label
   *  {@link roadNetworkNear} returned since the last road change. */
  roadNetworkGap(network: number, x: number, y: number): Fixed {
    if (this.roadNetworks === undefined || network === NO_ROAD_NETWORK) return NO_ROAD_DISTANCE;
    return this.roadNetworks.gapTo(network, x, y);
  }

  /**
   * The factor a route step onto `node` is weighed by, for a node the caller has bounds-checked. Original
   * behavior: the search charges each step the resistance of the node it leaves, so walkers keep to roads
   * and round sand and snow. Weighing the entered node by the step's world length is an approximation;
   * on even steps it only shifts every route between two fixed ends by a constant. Ships sail unweighted.
   */
  routeWeightAt(node: NodeId, traversal: Traversal): Fixed {
    if (traversal !== 'land') return ONE;
    const factor = this.routeFactors[node];
    return factor === undefined ? ONE : (ROUTE_WEIGHT_BY_FACTOR[factor] ?? ONE);
  }

  /** {@link routeWeightAt} per node as an integer factor, or undefined where every step weighs one (at
   *  sea). Kept current by every road change; callers must not write it. */
  routeFactorLane(traversal: Traversal): Uint8Array | undefined {
    return traversal === 'land' ? this.routeFactors : undefined;
  }

  /** The world road revision the lanes mirror; {@link UNSYNCED_ROAD_REVISION} before the first sync. */
  get mirroredRoadRevision(): number {
    return this.roadRevision;
  }

  /**
   * Mirror the world's road network into the per-node lanes, once per road revision; a repeat call with
   * the revision already mirrored costs nothing. The world owns the network (`systems/roads`); these
   * lanes only serve the per-step reads and the route heuristic. A change rebuilds the lanes in
   * O(map nodes), about 3 ms on a 480 x 380 node map: the path for a restore, a first road or a removal;
   * {@link extendRoads} mirrors a laid road.
   */
  syncRoads(revision: number, nodes: Iterable<NodeId>): void {
    if (revision === this.roadRevision) return;
    for (const node of this.roadNodes) this.setRoad(node, false);
    this.roadNodes = [];
    for (const node of nodes) {
      if (this.roads[node] === 1) continue;
      this.setRoad(node, true);
      this.roadNodes.push(node);
    }
    if (this.roadNodes.length > 0 || this.roadDistances !== undefined) {
      this.roadDistances ??= new RoadDistanceField(this.width, this.height);
      this.roadDistances.rebuild(this.roadNodes);
      this.roadNetworks ??= new RoadNetworks(this.width, this.height);
      this.roadNetworks.clear();
      for (const node of this.roadNodes) this.roadNetworks.add(node);
    }
    this.roadRevision = revision;
  }

  /**
   * Mirror roads laid over `added` that took the network from revision `from` to `revision`, at a cost
   * that follows the added nodes and the ground they now serve rather than the map. Returns false, with
   * nothing changed, when the lanes do not hold revision `from` or no road was mirrored yet; the caller
   * then rebuilds through {@link syncRoads}.
   */
  extendRoads(from: number, revision: number, added: Iterable<NodeId>): boolean {
    if (from !== this.roadRevision || this.roadDistances === undefined || this.roadNetworks === undefined) {
      return false;
    }
    for (const node of added) {
      if (this.roads[node] === 1) continue;
      this.setRoad(node, true);
      this.roadNodes.push(node);
      this.roadNetworks.add(node);
    }
    this.roadDistances.lower(added, this.roadNodes);
    this.roadRevision = revision;
    return true;
  }

  private setRoad(node: NodeId, road: boolean): void {
    this.checkedSlot(this.roads, node);
    this.roads[node] = road ? 1 : 0;
    this.routeFactors[node] = routeFactorOf(road ? ROAD_RESISTANCE : this.roughnessAt(node));
    const resistance = this.isWalkable(node) ? this.resistanceAt(node) : 0;
    if (this.entryResistances[node] !== resistance) {
      this.entryResistances[node] = resistance;
      this.resistanceChanges++;
      this.resistanceStamps.stamp(this.xOf(node), this.yOf(node), this.resistanceChanges);
    }
  }

  /** Source elevation unit under one half-cell node; absent maps are flat. */
  elevationAt(hx: number, hy: number): number {
    if (this.elevation === undefined) return 0;
    const cellWidth = Math.ceil(this.width / 2);
    const cellHeight = Math.ceil(this.height / 2);
    const cell = cellOfNode(hx, hy);
    const x = Math.max(0, Math.min(cellWidth - 1, cell.cx));
    const y = Math.max(0, Math.min(cellHeight - 1, cell.cy));
    return this.elevation[y * cellWidth + x] ?? 0;
  }

  /**
   * The static-connectivity label of a node, the continent key land and water share: nodes reachable
   * over static terrain by one mover class share a label, land labels come first and water labels
   * after them, and a node no class enters (a rock face, a tree trunk, the border) is
   * {@link NO_COMPONENT}. A walk-block overlay only removes edges, so two differently labelled nodes
   * are provably unreachable under any overlay. Labels are assigned by ascending seed id at build
   * time, making them a pure function of the terrain.
   */
  componentOf(node: NodeId): number {
    return this.checkedSlot(this.components, node);
  }

  /** The box holding every node labelled `component`, a label {@link componentOf} returned. */
  componentBounds(component: number): ComponentBox {
    this.componentBoxes ??= this.computeComponentBoxes();
    const box = this.componentBoxes[component];
    if (box === undefined) throw new Error(`no component ${component}`);
    return box;
  }

  private computeComponentBoxes(): ComponentBox[] {
    const boxes: { minX: number; minY: number; maxX: number; maxY: number }[] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const label = this.componentOf(this.idAt(x, y));
        if (label === NO_COMPONENT) continue;
        const box = boxes[label];
        if (box === undefined) {
          boxes[label] = { minX: x, minY: y, maxX: x, maxY: y };
          continue;
        }
        box.minX = Math.min(box.minX, x);
        box.minY = Math.min(box.minY, y);
        box.maxX = Math.max(box.maxX, x);
        box.maxY = Math.max(box.maxY, y);
      }
    }
    return boxes;
  }

  /** Flood-fill the static components over the pathfinder's own edge set, so the edge rule has one
   *  owner: the land components first, then the water bodies. Edges are symmetric within one class's
   *  node set, so the BFS labelling is well-defined. Runs from the constructor, so an override of
   *  {@link stepsInto} would see a subclass's own fields still uninitialised. */
  private computeComponents(): Int32Array {
    const components = new Int32Array(this.nodeCount).fill(NO_COMPONENT);
    const queue: NodeId[] = [];
    const edges = new StepBuffer();
    let nextLabel = 0;
    for (const traversal of TRAVERSALS) {
      for (let seed = 0; seed < this.nodeCount; seed++) {
        if (components[seed] !== NO_COMPONENT || !this.traversable(seed as NodeId, traversal)) continue;
        const label = nextLabel;
        nextLabel += 1;
        components[seed] = label;
        queue.length = 0;
        queue.push(seed as NodeId);
        // The array iterator re-reads `length` each step, so `queue` is a live BFS queue: nodes pushed
        // while walking it are visited in turn.
        for (const cur of queue) {
          this.stepsInto(cur, undefined, edges, traversal);
          for (let i = 0; i < edges.length; i++) {
            const { node } = edges.at(i);
            if (components[node] === NO_COMPONENT) {
              components[node] = label;
              queue.push(node);
            }
          }
        }
      }
    }
    return components;
  }
}
