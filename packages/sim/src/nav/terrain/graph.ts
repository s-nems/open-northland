import { type Fixed, fx, ONE } from '../../core/fixed.js';
import { cellOfNode } from '../halfcell.js';
import { TerrainEdges } from './edges.js';
import type { LandscapeProps } from './landscape-props.js';
import type { LandscapeMapInput } from './landscapes.js';
import type { Traversal } from './lattice.js';
import type { NodeId } from './node-id.js';
import { fillRoadDistances, NO_ROAD_DISTANCE } from './road-distance.js';
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

/** The road revision of a graph no road network has been mirrored into yet; world revisions start at 0. */
const UNSYNCED_ROAD_REVISION = -1;

/**
 * The sim's navigation model: the half-cell node lattice with its 8-direction edge set and each node's
 * static connectivity label. Distinct from the render's triangle tessellation. Construct through
 * {@link buildTerrainGraph}.
 */
export class TerrainGraph extends TerrainEdges {
  private readonly components: Int32Array;
  /** Per-node `lmpr` roughness, or undefined for the uniform default. */
  private readonly roughness: Uint8Array | undefined;
  /** Per-node road flag, the world's road network mirrored by {@link syncRoads}. */
  private readonly roads: Uint8Array;
  private roadNodes: NodeId[] = [];
  private roadRevision = UNSYNCED_ROAD_REVISION;
  /** Per-node lattice distance to the nearest road, allocated with the first road. */
  private roadDistances: Int32Array | undefined;
  /** Per-node land route weight: the node's resistance, at least {@link MIN_ROUTE_RESISTANCE}, as a
   *  multiple of ONE. */
  private readonly routeWeights: Fixed[];

  constructor(
    width: number,
    height: number,
    typeIds: Int32Array,
    props: ReadonlyMap<number, LandscapeProps>,
    readonly landscapes?: LandscapeMapInput,
    landVertices?: readonly boolean[],
    /** The original `lmco` continent id per node, the authored key fish swarms are matched on; the
     *  movers compare {@link componentOf} instead. */
    readonly waterContinents?: readonly number[],
    roughness?: readonly number[],
    readonly elevation?: readonly number[],
  ) {
    super(width, height, typeIds, props, landVertices);
    if (waterContinents !== undefined && waterContinents.length !== this.nodeCount) {
      throw new Error(`water continent lane has ${waterContinents.length} nodes, expected ${this.nodeCount}`);
    }
    if (roughness !== undefined && roughness.length !== this.nodeCount) {
      throw new Error(`roughness lane has ${roughness.length} nodes, expected ${this.nodeCount}`);
    }
    this.roughness = roughness === undefined ? undefined : Uint8Array.from(roughness);
    this.roads = new Uint8Array(this.nodeCount);
    this.routeWeights = new Array<Fixed>(this.nodeCount);
    for (let i = 0; i < this.nodeCount; i++) {
      const node = i as NodeId;
      this.routeWeights[node] = routeWeightOf(this.roughnessAt(node));
    }
    const cellCount = Math.ceil(width / 2) * Math.ceil(height / 2);
    if (elevation !== undefined && elevation.length !== cellCount) {
      throw new Error(`elevation lane has ${elevation.length} cells, expected ${cellCount}`);
    }
    this.components = this.computeComponents();
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

  /** Whether a road runs over `node`. Throws on an id outside the grid. */
  isRoad(node: NodeId): boolean {
    return this.checkedSlot(this.roads, node) !== 0;
  }

  /** The obstacle-free lattice distance from `node` to the nearest road in column units, or
   *  {@link NO_ROAD_DISTANCE} on a map without roads; for a node the caller has bounds-checked. */
  roadDistanceAt(node: NodeId): Fixed {
    // The lane stores Fixed values; a typed array only drops the brand.
    return (this.roadDistances?.[node] ?? NO_ROAD_DISTANCE) as Fixed;
  }

  /**
   * The factor a route step onto `node` is weighed by, for a node the caller has bounds-checked. Original
   * behavior: the search charges each step the resistance of the node it enters, so walkers keep to roads
   * and round sand and snow. Ships sail unweighted.
   */
  routeWeightAt(node: NodeId, traversal: Traversal): Fixed {
    return traversal === 'land' ? (this.routeWeights[node] ?? ONE) : ONE;
  }

  /**
   * Mirror the world's road network into the per-node lanes, once per road revision; a repeat call with
   * the revision already mirrored costs nothing. The world owns the network (`systems/roads`); these
   * lanes only serve the per-step reads and the route heuristic. A change rebuilds the road distances,
   * O(map nodes): about 2 ms on a 480 x 380 node map.
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
      this.roadDistances ??= new Int32Array(this.nodeCount);
      fillRoadDistances(this.roadDistances, this.width, this.height, this.roadNodes);
    }
    this.roadRevision = revision;
  }

  private setRoad(node: NodeId, road: boolean): void {
    this.checkedSlot(this.roads, node);
    this.roads[node] = road ? 1 : 0;
    this.routeWeights[node] = routeWeightOf(road ? ROAD_RESISTANCE : this.roughnessAt(node));
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

  /** Flood-fill the static components over the pathfinder's own edge set, so the diagonal flank-seam
   *  rule has one owner: the land components first, then the water bodies. Edges are symmetric within
   *  one class's node set, so the BFS labelling is well-defined. Runs from the constructor, so an
   *  override of {@link stepsInto} would see a subclass's own fields still uninitialised. */
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

function routeWeightOf(resistance: number): Fixed {
  return fx.fromInt(resistance < MIN_ROUTE_RESISTANCE ? MIN_ROUTE_RESISTANCE : resistance);
}
