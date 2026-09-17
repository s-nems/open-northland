/**
 * Navigation, pathfinding, and placement operate on the original's `2W x 2H` logic lattice. Source
 * basis: the decoded map object lanes `lmlt`, `emla`, `lmlv`, `map.cif` StaticObjects placements, and
 * `LogicWalkBlockArea`/`LogicBuildBlockArea` footprint offsets all address `2W x 2H`; the half-cell
 * anchoring is the best-aligned reading of the `lmlt` blocking lane, measured in docs/formats/MAPDAT.md.
 *
 * Node `(hx, hy)` sits at world `(hx/2 column, hy/2 row)`, a 34 px by 19 px pitch under the measured
 * 68x38 px projection, and cell `(c, r)` is node `(2c + (r&1), 2r)`, so the staggered raster becomes a
 * rectangular lattice with one parity-independent neighbour table.
 */
import { type Fixed, ONE } from '../../core/fixed.js';

import { type LandscapeProps, UNKNOWN_LANDSCAPE_PROPS } from './landscape-props.js';
import type { NodeId } from './node-id.js';

/** The per-node flag bits a node's {@link LandscapeProps} resolve to. */
const WALKABLE = 1;
const BUILDABLE = 2;
const PLANTABLE = 4;

function flagsOf(p: LandscapeProps): number {
  return (p.walkable ? WALKABLE : 0) | (p.buildable ? BUILDABLE : 0) | (p.plantable ? PLANTABLE : 0);
}

/**
 * The ground a mover crosses: settlers, carts and catapults walk the land, ships sail the water. One
 * graph serves both, the original's single navigation map whose continents come in a land and a water
 * kind (docs/formats/VEHICLES.md "Movement"); the class picks which nodes an edge may enter.
 */
export type Traversal = 'land' | 'water';

export abstract class TerrainLattice {
  readonly width: number;
  readonly height: number;
  /** Row-major landscape typeId per node (length === width*height). */
  private readonly typeIds: Int32Array;
  /** Each node's resolved props, row-major like {@link typeIds}, so the step test reads a slot instead
   *  of looking the node's type up. The terrain is immutable; live walk blocks are an overlay. */
  private readonly flags: Uint8Array;
  private readonly walkCosts: readonly Fixed[];

  constructor(
    width: number,
    height: number,
    typeIds: Int32Array,
    props: ReadonlyMap<number, LandscapeProps>,
    /** Ground vertex land mask, row-major; absent, every unwalkable node reads as water. */
    readonly landVertices?: readonly boolean[],
  ) {
    if (width <= 0 || height <= 0) throw new Error(`terrain dimensions must be positive: ${width}x${height}`);
    if (typeIds.length !== width * height) {
      throw new Error(
        `terrain grid has ${typeIds.length} nodes, expected ${width * height} (${width}x${height})`,
      );
    }
    if (landVertices !== undefined && landVertices.length !== width * height) {
      throw new Error(`land vertex mask has ${landVertices.length} nodes, expected ${width * height}`);
    }
    this.width = width;
    this.height = height;
    this.typeIds = typeIds;
    const propsOf = (typeId: number): LandscapeProps => props.get(typeId) ?? UNKNOWN_LANDSCAPE_PROPS;
    this.flags = Uint8Array.from(typeIds, (typeId) => flagsOf(propsOf(typeId)));
    this.walkCosts = Array.from(typeIds, (typeId) => propsOf(typeId).walkCost);
  }

  get nodeCount(): number {
    return this.width * this.height;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** The row-major node id for coordinates the caller has already bounds- or clamp-checked. */
  protected idAt(x: number, y: number): NodeId {
    return (y * this.width + x) as NodeId;
  }

  /** The node id at (x, y). Throws if out of bounds - an out-of-range lookup is a programmer error. */
  nodeAt(x: number, y: number): NodeId {
    if (!this.inBounds(x, y))
      throw new Error(`node (${x}, ${y}) out of bounds (${this.width}x${this.height})`);
    return this.idAt(x, y);
  }

  xOf(node: NodeId): number {
    return node % this.width;
  }

  yOf(node: NodeId): number {
    return Math.floor(node / this.width);
  }

  /** A per-node hot path uses {@link xOf} and {@link yOf} instead, avoiding the object. */
  coordsOf(node: NodeId): { x: number; y: number } {
    return { x: this.xOf(node), y: this.yOf(node) };
  }

  /**
   * The node at integer half-cell coordinates, clamped into the grid. Unlike {@link nodeAt} this never
   * throws, so a border-seam transient clamps to the nearest border node rather than crashing a tick.
   */
  nodeAtClamped(x: number, y: number): NodeId {
    const cx = x < 0 ? 0 : x >= this.width ? this.width - 1 : x;
    const cy = y < 0 ? 0 : y >= this.height ? this.height - 1 : y;
    return this.idAt(cx, cy);
  }

  /** A per-node value from one of the row-major arrays, throwing on an id outside the grid. */
  protected checkedSlot(arr: Int32Array | Uint8Array, node: NodeId): number {
    const v = arr[node];
    if (v === undefined) throw new Error(`node id ${node} out of range (0..${this.nodeCount - 1})`);
    return v;
  }

  /** The landscape typeId tagged on a node. Throws on an id outside the grid. */
  typeAt(node: NodeId): number {
    return this.checkedSlot(this.typeIds, node);
  }

  /** True if a unit may stand on / walk through this node. */
  isWalkable(node: NodeId): boolean {
    return (this.checkedSlot(this.flags, node) & WALKABLE) !== 0;
  }

  /** Open water: ground no unit walks and no land vertex claims, so a rock face or a tree trunk on land
   *  stays land. A ship sails where this holds. */
  isWater(node: NodeId): boolean {
    return !this.isWalkable(node) && this.landVertices?.[node] !== true;
  }

  /** Whether a mover of `traversal` may stand on this node: {@link isWalkable} on land, {@link isWater}
   *  at sea. */
  traversable(node: NodeId, traversal: Traversal): boolean {
    return traversal === 'land' ? this.isWalkable(node) : this.isWater(node);
  }

  /** Whether a building's reserved zone may cover this node. Placement only; navigation reads
   *  {@link isWalkable}. */
  isBuildable(node: NodeId): boolean {
    return (this.checkedSlot(this.flags, node) & BUILDABLE) !== 0;
  }

  /** Whether crops may be sown on this node. Farming only. */
  isPlantable(node: NodeId): boolean {
    return (this.checkedSlot(this.flags, node) & PLANTABLE) !== 0;
  }

  walkCost(node: NodeId): Fixed {
    const cost = this.walkCosts[node];
    if (cost === undefined) throw new Error(`node id ${node} out of range (0..${this.nodeCount - 1})`);
    return cost;
  }

  /** {@link isWalkable} for a node the caller has already bounds-checked, as the step test's hot read. */
  protected walkableAt(node: NodeId): boolean {
    return ((this.flags[node] ?? 0) & WALKABLE) !== 0;
  }

  /** {@link walkCost} for a node the caller has already bounds-checked. */
  protected walkCostAt(node: NodeId): Fixed {
    return this.walkCosts[node] ?? ONE;
  }
}
