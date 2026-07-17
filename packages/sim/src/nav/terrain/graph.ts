/**
 * The terrain half-cell adjacency graph — the sim's navigation model (docs/ECS.md), distinct from
 * the triangle render tessellation. Navigation, pathfinding, and placement operate on the original's
 * `2W×2H` logic lattice (source basis: decoded map object lanes `lmlt`/`emla`/`lmlv`, `map.cif`
 * StaticObjects placements, and `LogicWalkBlockArea`/`LogicBuildBlockArea` footprint offsets all
 * address `2W×2H`; the half-cell anchoring is the best-aligned reading of the `lmlt` blocking lane —
 * measurement in docs/formats/MAPDAT.md). Each node carries a landscape `typeId` (IR's
 * {@link LandscapeType}) resolving to walkability and a fixed-point walk cost.
 *
 * Geometry: node `(hx, hy)` sits at world `(hx·½ column, hy·½ row)` = (34 px, 19 px) pitch under the
 * measured 68×38 px projection; cell `(c, r)` = node `(2c + (r&1), 2r)`, so the staggered raster
 * becomes a rectangular lattice with one parity-independent neighbour table.
 *
 * Movement keeps the original's 8 directions (`THexagonDirection`: E/SE/SW/W/NW/NE plus NORTH = 6,
 * SOUTH = 7, from the shipped `Data/GameSourceIncludes/logicdefines.inc`), one half-cell fine
 * ({@link TerrainGraph.steps}): E/W = `(±1, 0)`, cost {@link HALF_COLUMN}; NE/SE/SW/NW = `(±1, ±2)`
 * (the 51 px lattice edge), cost {@link DIAGONAL_STEP}; N/S = `(0, ±1)`, cost {@link HALF_ROW}. That
 * the original walks this lattice (rather than only blocking on it) is a named approximation — no
 * movement code survives readable, but the direction set, edge geometry, and half-cell collision are
 * data-pinned and the observed unit packing density matches it. A diagonal edge passes between the
 * two nodes flanking its midpoint and stays passable
 * while at least one flank is (both blocked = a wall joint, not a gap); E/W and N/S connect directly
 * adjacent nodes, so walkability is a property of the destination node.
 *
 * Determinism: a plain-data world resource (not entities), nodes addressed by row-major id
 * (`hy * width + hx`), neighbours emitted in a fixed canonical order so traversal is byte-identical
 * across runs. All costs are `Fixed`.
 */
import { type Fixed, fx } from '../../core/fixed.js';
import { DIAGONAL_STEP, HALF_COLUMN, HALF_ROW } from '../metric.js';

import { type NodeTypeProps, UNKNOWN_NODE_TYPE } from './node-types.js';
import { type Step, StepBuffer } from './step-buffer.js';
import type { BlockOverlay, NodeId } from './types.js';

/** Canonical orthogonal neighbour offsets in N, E, S, W order — the fixed traversal order for
 *  determinism. */
const NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [0, -1], // N
  [1, 0], // E
  [0, 1], // S
  [-1, 0], // W
] as const;

/** The two E/W half-column edges (34 px), canonical E then W. */
const COLUMN_STEP_OFFSETS: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [1, 0], // E
  [-1, 0], // W
] as const;

/** The four diagonal lattice edges (`(±1, ±2)`, 51 px) in canonical NE, SE, SW, NW screen-heading
 *  order — the fixed order (after E/W) keeps A* expansion history-independent. */
const DIAGONAL_STEP_OFFSETS: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [1, -2], // NE
  [1, 2], // SE
  [-1, 2], // SW
  [-1, -2], // NW
] as const;

/** The two straight vertical edges (19 px half-row), canonical N then S — the `THexagonDirection`
 *  enum tail (NORTH = 6, SOUTH = 7). */
const VERTICAL_STEP_OFFSETS: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [0, -1], // N
  [0, 1], // S
] as const;

/**
 * The terrain navigation graph: a width×height grid of half-cell nodes (`2W×2H` for a `W×H`-cell
 * map), each tagged with a landscape typeId, plus the resolved per-type properties. Construct via
 * {@link buildTerrainGraph}.
 */
export class TerrainGraph {
  readonly width: number;
  readonly height: number;
  /** Row-major landscape typeId per node (length === width*height). */
  private readonly typeIds: Int32Array;
  /** typeId -> resolved sim props, frozen at build time. */
  private readonly props: ReadonlyMap<number, NodeTypeProps>;
  /** Static-connectivity label per node (-1 = unwalkable), from a build-time flood fill over
   *  {@link steps}. See {@link componentOf}. */
  private readonly components: Int32Array;
  /** The fill target backing the allocating {@link steps}; its contents never outlive that call. */
  private readonly stepScratch = new StepBuffer();

  constructor(width: number, height: number, typeIds: Int32Array, props: ReadonlyMap<number, NodeTypeProps>) {
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
    this.components = this.computeComponents();
  }

  /** Total node count. */
  get nodeCount(): number {
    return this.width * this.height;
  }

  /** True if (x, y) is inside the grid. */
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** The row-major node id for in-bounds coordinates — the class's addressing invariant, unchecked
   *  (callers that reach here have already bounds- or clamp-checked `x`, `y`). */
  private idAt(x: number, y: number): NodeId {
    return (y * this.width + x) as NodeId;
  }

  /** The node id at (x, y). Throws if out of bounds — an out-of-range lookup is a programmer error. */
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
   * {@link nodeAt} this never throws — it is the navigation planner's seam from an entity's node
   * address (`nodeOfPosition`) to a node id, so an out-of-range coordinate clamps to the nearest
   * border node rather than crashing a tick.
   */
  nodeAtClamped(x: number, y: number): NodeId {
    const cx = x < 0 ? 0 : x >= this.width ? this.width - 1 : x;
    const cy = y < 0 ? 0 : y >= this.height ? this.height - 1 : y;
    return this.idAt(cx, cy);
  }

  /** A per-node value from one of the row-major arrays, throwing on an id outside the grid
   *  (a programmer error). Shared by {@link typeAt} and {@link componentOf}. */
  private checkedSlot(arr: Int32Array, node: NodeId): number {
    const v = arr[node];
    if (v === undefined) throw new Error(`node id ${node} out of range (0..${this.nodeCount - 1})`);
    return v;
  }

  /** The landscape typeId tagged on a node. Throws on an id outside the grid (programmer error). */
  typeAt(node: NodeId): number {
    return this.checkedSlot(this.typeIds, node);
  }

  private propsOf(node: NodeId): NodeTypeProps {
    return this.props.get(this.typeAt(node)) ?? UNKNOWN_NODE_TYPE;
  }

  /** True if a unit may stand on / walk through this node. */
  isWalkable(node: NodeId): boolean {
    return this.propsOf(node).walkable;
  }

  /** True if a building's reserved zone may cover this node (the landscape row's `buildable` flag —
   *  water/rock/void are neither walkable nor buildable; a real map's object margin is walkable but
   *  not buildable). Placement-only; navigation reads {@link isWalkable}. */
  isBuildable(node: NodeId): boolean {
    return this.propsOf(node).buildable;
  }

  /** True if crops may be SOWN on this node (the landscape row's `plantable` flag — the original's
   *  `biocanplanton` ground class, carried only by grass/land). Farming-only; navigation and
   *  placement never read it. */
  isPlantable(node: NodeId): boolean {
    return this.propsOf(node).plantable;
  }

  /** Fixed-point cost to step onto this node. */
  walkCost(node: NodeId): Fixed {
    return this.propsOf(node).walkCost;
  }

  /**
   * The in-bounds 4-connected neighbours of a node, in canonical N, E, S, W order. Border nodes simply
   * yield fewer neighbours.
   */
  neighbours(node: NodeId): NodeId[] {
    const x = this.xOf(node);
    const y = this.yOf(node);
    const out: NodeId[] = [];
    for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (this.inBounds(nx, ny)) out.push(this.idAt(nx, ny));
    }
    return out;
  }

  /**
   * The walkable subset of {@link neighbours} (4-connected), same canonical order — the adjacency
   * relation for placement, not the pathfinder's edge set (movement is 8-connected via {@link steps}).
   */
  walkableNeighbours(node: NodeId): NodeId[] {
    const x = this.xOf(node);
    const y = this.yOf(node);
    const out: NodeId[] = [];
    for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!this.inBounds(nx, ny)) continue;
      const c = this.idAt(nx, ny);
      if (this.isWalkable(c)) out.push(c);
    }
    return out;
  }

  /**
   * The pathfinder's 8-direction edge set from `node`: E/W half-column steps, then the four diagonals
   * (NE, SE, SW, NW), then N/S half-row steps. Each step's cost is the destination node's
   * {@link walkCost} × the edge's world length (E/W = {@link HALF_COLUMN}, diagonal =
   * {@link DIAGONAL_STEP}, vertical = {@link HALF_ROW}), so A* minimises true on-screen distance.
   * `blocked` is the dynamic walk-block overlay; a step onto a blocked or unwalkable destination is
   * omitted, and a diagonal additionally needs at least one of its two midpoint flanks passable (both
   * blocked = a wall joint, not a gap). The emission order is pinned by the pathfinding goldens and
   * must not be reordered.
   */
  steps(node: NodeId, blocked?: BlockOverlay): Step[] {
    this.stepsInto(node, blocked, this.stepScratch);
    const out: Step[] = [];
    for (let i = 0; i < this.stepScratch.length; i++) {
      const step = this.stepScratch.at(i);
      out.push({ node: step.node, cost: step.cost });
    }
    return out;
  }

  /**
   * {@link steps}, emitted into a caller-owned buffer instead of a fresh array — the allocation-free
   * form the A* inner loop and the component flood fill use, since they consume each edge set and
   * drop it. `out` is reset first and holds the edges in the same canonical order.
   */
  stepsInto(node: NodeId, blocked: BlockOverlay | undefined, out: StepBuffer): void {
    const x = this.xOf(node);
    const y = this.yOf(node);
    out.reset();
    // Half-column steps first, canonical E then W.
    for (const [dx, dy] of COLUMN_STEP_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!this.passable(nx, ny, blocked)) continue;
      const c = this.idAt(nx, ny);
      out.push(c, fx.mul(this.walkCost(c), HALF_COLUMN));
    }
    // Diagonal steps, canonical NE,SE,SW,NW — gated on the flanked midpoint seam.
    for (const [dx, dy] of DIAGONAL_STEP_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!this.passable(nx, ny, blocked)) continue;
      const fy = y + dy / 2;
      if (!this.passable(x, fy, blocked) && !this.passable(nx, fy, blocked)) continue;
      const c = this.idAt(nx, ny);
      out.push(c, fx.mul(this.walkCost(c), DIAGONAL_STEP));
    }
    // Vertical half-row steps last, canonical N then S (the THexagonDirection tail order).
    for (const [dx, dy] of VERTICAL_STEP_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!this.passable(nx, ny, blocked)) continue;
      const c = this.idAt(nx, ny);
      out.push(c, fx.mul(this.walkCost(c), HALF_ROW));
    }
  }

  /** Whether `(nx, ny)` is in bounds, walkable, and not currently masked by the dynamic `blocked`
   *  overlay — the per-step passability test {@link stepsInto} applies to each candidate edge. */
  private passable(nx: number, ny: number, blocked?: BlockOverlay): boolean {
    if (!this.inBounds(nx, ny)) return false;
    const c = this.idAt(nx, ny);
    return this.isWalkable(c) && !(blocked?.has(c) ?? false);
  }

  /**
   * The static-connectivity label of a node: nodes reachable over static terrain share a label,
   * unwalkable nodes are -1. The dynamic walk-block overlay only ever removes edges, so two nodes with
   * different labels are provably unreachable under any overlay — the pathfinder uses this to answer
   * "no route" without flooding the component. Labels are assigned by ascending seed id at build time,
   * so they are a pure function of the terrain (lockstep-safe).
   */
  componentOf(node: NodeId): number {
    return this.checkedSlot(this.components, node);
  }

  /** Flood-fill the static components over the pathfinder's own edge set ({@link stepsInto} with no
   *  overlay), so the diagonal flank-seam rule has exactly one owner. Edges are symmetric within
   *  the walkable set (destination-walkability + the shared flank pair), so a BFS labelling is
   *  well-defined. One-time O(nodes) build cost. */
  private computeComponents(): Int32Array {
    const components = new Int32Array(this.nodeCount).fill(-1);
    const queue: NodeId[] = [];
    const edges = new StepBuffer();
    let nextLabel = 0;
    for (let seed = 0; seed < this.nodeCount; seed++) {
      if (components[seed] !== -1 || !this.isWalkable(seed as NodeId)) continue;
      const label = nextLabel;
      nextLabel += 1;
      components[seed] = label;
      queue.length = 0;
      queue.push(seed as NodeId);
      // The array iterator re-reads `length` each step, so `queue` is a live BFS queue: nodes pushed
      // while walking it are visited in turn.
      for (const cur of queue) {
        this.stepsInto(cur, undefined, edges);
        for (let i = 0; i < edges.length; i++) {
          const { node } = edges.at(i);
          if (components[node] === -1) {
            components[node] = label;
            queue.push(node);
          }
        }
      }
    }
    return components;
  }
}
