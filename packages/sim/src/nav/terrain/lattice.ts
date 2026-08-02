/**
 * Navigation, pathfinding, and placement operate on the original's `2W×2H` logic lattice (source
 * basis: decoded map object lanes `lmlt`/`emla`/`lmlv`, `map.cif` StaticObjects placements, and
 * `LogicWalkBlockArea`/`LogicBuildBlockArea` footprint offsets all address `2W×2H`; the half-cell
 * anchoring is the best-aligned reading of the `lmlt` blocking lane, measurement in
 * docs/formats/MAPDAT.md). A `W×H`-cell map becomes a width×height grid of half-cell nodes, each
 * carrying a landscape `typeId` (IR's {@link LandscapeType}) that resolves to walkability and a
 * fixed-point walk cost.
 *
 * Geometry: node `(hx, hy)` sits at world `(hx·½ column, hy·½ row)` = (34 px, 19 px) pitch under the
 * measured 68×38 px projection; cell `(c, r)` = node `(2c + (r&1), 2r)`, so the staggered raster
 * becomes a rectangular lattice with one parity-independent neighbour table. Determinism: a
 * plain-data world resource (not entities), nodes addressed by row-major id (`hy * width + hx`).
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

  /** Total node count. */
  get nodeCount(): number {
    return this.width * this.height;
  }

  /** True if (x, y) is inside the grid. */
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** The row-major node id for in-bounds coordinates - the class's addressing invariant, unchecked
   *  (callers that reach here have already bounds- or clamp-checked `x`, `y`). */
  protected idAt(x: number, y: number): NodeId {
    return (y * this.width + x) as NodeId;
  }

  /** The node id at (x, y). Throws if out of bounds - an out-of-range lookup is a programmer error. */
  nodeAt(x: number, y: number): NodeId {
    if (!this.inBounds(x, y))
      throw new Error(`node (${x}, ${y}) out of bounds (${this.width}x${this.height})`);
    return this.idAt(x, y);
  }

  /** The x coordinate of a node id. */
  xOf(node: NodeId): number {
    return node % this.width;
  }

  /** The y coordinate of a node id. */
  yOf(node: NodeId): number {
    return Math.floor(node / this.width);
  }

  /** The (x, y) coordinates of a node id. Callers on a per-node hot path use {@link xOf}/{@link yOf}
   *  instead, so a coordinate lookup costs no object. */
  coordsOf(node: NodeId): { x: number; y: number } {
    return { x: this.xOf(node), y: this.yOf(node) };
  }

  /**
   * The node at integer half-cell coordinates (`x`, `y`), clamped into the grid. Unlike
   * {@link nodeAt} this never throws - it is the navigation planner's seam from an entity's node
   * address (`nodeOfPosition`) to a node id, so an out-of-range coordinate clamps to the nearest
   * border node rather than crashing a tick.
   */
  nodeAtClamped(x: number, y: number): NodeId {
    const cx = x < 0 ? 0 : x >= this.width ? this.width - 1 : x;
    const cy = y < 0 ? 0 : y >= this.height ? this.height - 1 : y;
    return this.idAt(cx, cy);
  }

  /** A per-node value from one of the row-major arrays, throwing on an id outside the grid
   *  (a programmer error). Shared by {@link typeAt} and the graph's connectivity labels. */
  protected checkedSlot(arr: Int32Array, node: NodeId): number {
    const v = arr[node];
    if (v === undefined) throw new Error(`node id ${node} out of range (0..${this.nodeCount - 1})`);
    return v;
  }

  /** The landscape typeId tagged on a node. Throws on an id outside the grid (programmer error). */
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

  /** True if a building's reserved zone may cover this node (the landscape row's `buildable` flag -
   *  water/rock/void are neither walkable nor buildable; a real map's object margin is walkable but
   *  not buildable). Placement-only; navigation reads {@link isWalkable}. */
  isBuildable(node: NodeId): boolean {
    return this.propsOf(node).buildable;
  }

  /** True if crops may be SOWN on this node (the landscape row's `plantable` flag - the original's
   *  `biocanplanton` ground class, carried only by grass/land). Farming-only; navigation and
   *  placement never read it. */
  isPlantable(node: NodeId): boolean {
    return this.propsOf(node).plantable;
  }

  /** Fixed-point cost to step onto this node. */
  walkCost(node: NodeId): Fixed {
    return this.propsOf(node).walkCost;
  }
}
