import { cellOfNode } from '../halfcell.js';
import { TerrainEdges } from './edges.js';
import type { LandscapeProps } from './landscape-props.js';
import type { LandscapeMapInput } from './landscapes.js';
import type { Traversal } from './lattice.js';
import type { NodeId } from './node-id.js';
import { StepBuffer } from './step-buffer.js';

/** The ground speed class every node reads until the map's roughness lane is imported. */
const FLAT_GROUND_SPEED_CLASS = 0;

/** The two mover classes in the order their continents are labelled. */
const TRAVERSALS: readonly Traversal[] = ['land', 'water'];

/**
 * The roughness every node of a map without an `lmpr` lane reads: the owned corpus's `land` value
 * (`trianglepatterntypes` land = 2, the ground most of a map is). A decoded map always carries its lane;
 * this only paces synthetic and scene terrain.
 */
export const DEFAULT_NODE_ROUGHNESS = 2;

/**
 * The sim's navigation model: the half-cell node lattice with its 8-direction edge set and each node's
 * static connectivity label. Distinct from the render's triangle tessellation. Construct through
 * {@link buildTerrainGraph}.
 */
export class TerrainGraph extends TerrainEdges {
  private readonly components: Int32Array;
  /** Per-node `lmpr` roughness, or undefined for the uniform default. */
  private readonly roughness: Uint8Array | undefined;

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
    const cellCount = Math.ceil(width / 2) * Math.ceil(height / 2);
    if (elevation !== undefined && elevation.length !== cellCount) {
      throw new Error(`elevation lane has ${elevation.length} cells, expected ${cellCount}`);
    }
    this.components = this.computeComponents();
  }

  /** The walking roughness a step off `node` is paced and shod by (the map's `lmpr` value, 0..5 on the
   *  owned corpus). Throws on an id outside the grid. */
  roughnessAt(node: NodeId): number {
    const v = this.roughness === undefined ? DEFAULT_NODE_ROUGHNESS : this.roughness[node];
    if (v === undefined || node < 0 || node >= this.nodeCount) {
      throw new Error(`node id ${node} out of range (0..${this.nodeCount - 1})`);
    }
    return v;
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
   * after them, and a node no class enters (a rock face, a tree trunk, the border) is -1. A walk-block
   * overlay only removes edges, so two differently labelled nodes are provably unreachable under any
   * overlay. Labels are assigned by ascending seed id at build time, making them a pure function of
   * the terrain.
   */
  componentOf(node: NodeId): number {
    return this.checkedSlot(this.components, node);
  }

  /**
   * The ground speed class `g` a vehicle's move period reads at a node, the original's 4-bit per-node
   * field beside the free-size class (docs/formats/VEHICLES.md "Movement"). Approximation: its readable
   * source is the map's `lmpr` roughness lane ({@link roughnessAt}), but the roughness-to-class mapping
   * is unverified, so every node reads the flat class; the seam keeps that mapping to one method.
   */
  groundSpeedClass(node: NodeId): number {
    this.checkedSlot(this.components, node);
    return FLAT_GROUND_SPEED_CLASS;
  }

  /** Flood-fill the static components over the pathfinder's own edge set, so the diagonal flank-seam
   *  rule has one owner: the land components first, then the water bodies. Edges are symmetric within
   *  one class's node set, so the BFS labelling is well-defined. Runs from the constructor, so an
   *  override of {@link stepsInto} would see a subclass's own fields still uninitialised. */
  private computeComponents(): Int32Array {
    const components = new Int32Array(this.nodeCount).fill(-1);
    const queue: NodeId[] = [];
    const edges = new StepBuffer();
    let nextLabel = 0;
    for (const traversal of TRAVERSALS) {
      for (let seed = 0; seed < this.nodeCount; seed++) {
        if (components[seed] !== -1 || !this.traversable(seed as NodeId, traversal)) continue;
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
            if (components[node] === -1) {
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
