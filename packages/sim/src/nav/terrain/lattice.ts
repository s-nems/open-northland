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
import type { Fixed } from '../../core/fixed.js';

import { type LandscapeProps, UNKNOWN_LANDSCAPE_PROPS } from './landscape-props.js';
import type { NodeId } from './node-id.js';

export abstract class TerrainLattice {
  readonly width: number;
  readonly height: number;
  /** Row-major landscape typeId per node (length === width*height). */
  private readonly typeIds: Int32Array;
  /** typeId -> resolved sim props, frozen at build time. */
  private readonly props: ReadonlyMap<number, LandscapeProps>;

  constructor(
    width: number,
    height: number,
    typeIds: Int32Array,
    props: ReadonlyMap<number, LandscapeProps>,
  ) {
    if (width <= 0 || height <= 0) throw new Error(`terrain dimensions must be positive: ${width}x${height}`);
    if (typeIds.length !== width * height) {
      throw new Error(
        `terrain grid has ${typeIds.length} nodes, expected ${width * height} (${width}x${height})`,
      );
    }
    this.width = width;
    this.height = height;
    this.typeIds = typeIds;
    this.props = props;
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
  protected checkedSlot(arr: Int32Array, node: NodeId): number {
    const v = arr[node];
    if (v === undefined) throw new Error(`node id ${node} out of range (0..${this.nodeCount - 1})`);
    return v;
  }

  /** The landscape typeId tagged on a node. Throws on an id outside the grid. */
  typeAt(node: NodeId): number {
    return this.checkedSlot(this.typeIds, node);
  }

  private propsOf(node: NodeId): LandscapeProps {
    return this.props.get(this.typeAt(node)) ?? UNKNOWN_LANDSCAPE_PROPS;
  }

  /** True if a unit may stand on / walk through this node. */
  isWalkable(node: NodeId): boolean {
    return this.propsOf(node).walkable;
  }

  /** Whether a building's reserved zone may cover this node. Placement only; navigation reads
   *  {@link isWalkable}. */
  isBuildable(node: NodeId): boolean {
    return this.propsOf(node).buildable;
  }

  /** Whether crops may be sown on this node. Farming only. */
  isPlantable(node: NodeId): boolean {
    return this.propsOf(node).plantable;
  }

  walkCost(node: NodeId): Fixed {
    return this.propsOf(node).walkCost;
  }
}
