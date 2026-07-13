/**
 * The terrain HALF-CELL ADJACENCY GRAPH — the sim's navigation model (docs/ECS.md, Phase 2).
 *
 * This is NOT the triangle render tessellation: navigation, pathfinding, and placement all operate
 * on a graph of HALF-CELLS — the original's `2W×2H` logic lattice. That resolution is pinned by the
 * data, not invented: the decoded map's object lanes (`lmlt`/`emla`/`lmlv`), `map.cif` StaticObjects
 * placements, and the `LogicWalkBlockArea`/`LogicBuildBlockArea` footprint offsets all address a
 * `2W×2H` grid (source basis: mapdat lane layout, OpenVikings format oracle; the verbatim half-cell
 * anchoring is additionally the best-aligned reading of the real maps' own `lmlt` blocking lane —
 * the measurement lives in docs/SOURCES.md). Each node carries a landscape `typeId` (from the IR's
 * {@link LandscapeType} table) which resolves to walkability, a fixed-point walk cost, and a
 * per-node valency (capacity).
 *
 * GEOMETRY: in half-cell coordinates the staggered raster becomes a PLAIN RECTANGULAR lattice —
 * node `(hx, hy)` sits at world `(hx·½ column, hy·½ row)` = (34 px, 19 px) pitch under the measured
 * 68×38 px projection, with the visual stagger arising from which nodes the cell centres occupy
 * (cell `(c, r)` = node `(2c + (r&1), 2r)`). So the old parity-dependent offset tables vanish: every
 * node has the SAME neighbour offsets.
 *
 * MOVEMENT keeps the original's 8 directions (`THexagonDirection`: E/SE/SW/W/NW/NE plus NORTH = 6,
 * SOUTH = 7 — readable in the original's shipped `Data/GameSourceIncludes/logicdefines.inc`, the
 * "Logic directions" block), now one half-cell fine ({@link TerrainGraph.steps}):
 *  - E/W = `(±1, 0)`, a 34 px half-column step, cost {@link HALF_COLUMN};
 *  - NE/SE/SW/NW = `(±1, ±2)`, the SAME 51 px lattice edge the full-cell graph priced (half a column
 *    sideways, one full row up/down), cost {@link DIAGONAL_STEP};
 *  - N/S = `(0, ±1)`, a 19 px half-row step, cost {@link HALF_ROW} — the straight vertical the old
 *    graph needed a two-row flanked seam for.
 * That the original WALKS this lattice (rather than only blocking on it) is a NAMED APPROXIMATION —
 * no movement code survives readable — but the direction set, the edge geometry, and the half-cell
 * collision resolution are all data-pinned, and the observed unit packing density matches it.
 * A diagonal edge passes between the two nodes flanking its midpoint; it stays passable while at
 * least ONE flank is (both blocked = a wall joint, not a gap — the same seam rule the old vertical
 * step carried). E/W and N/S steps connect directly adjacent nodes: walkability is a property of the
 * DESTINATION node, the original's vertex-graph movement model.
 *
 * DETERMINISM: the graph is a plain-data world resource (not entities). Nodes are addressed by a
 * monotonic row-major id (`hy * width + hx`), and neighbours are emitted in a fixed canonical order
 * so traversal is byte-identical across runs — the precondition for A* with canonical tie-breaking
 * and lockstep replay. All costs are `Fixed`; no floats touch state.
 */
import { type Fixed, fx } from '../../core/fixed.js';
import { DIAGONAL_STEP, HALF_COLUMN, HALF_ROW } from '../metric.js';

import { type NodeTypeProps, UNKNOWN_NODE_TYPE } from './node-types.js';
import type { BlockOverlay, NodeId } from './types.js';

/** Canonical orthogonal neighbour offsets in N, E, S, W order — the fixed traversal order for
 *  determinism. On the half-cell lattice these are a 19 px half-row and a 34 px half-column. */
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

/**
 * The four DIAGONAL lattice edges in canonical NE, SE, SW, NW screen-heading order — `(±1, ±2)` in
 * half-cells is exactly the old full-cell row-crossing edge (half a column sideways, one full row
 * up/down, 51 px). Parity-independent: the half-cell lattice is rectangular, so every node shares
 * this one table. The fixed order (after E/W) keeps A* expansion history-independent.
 */
const DIAGONAL_STEP_OFFSETS: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [1, -2], // NE
  [1, 2], // SE
  [-1, 2], // SW
  [-1, -2], // NW
] as const;

/** The two straight VERTICAL edges (19 px half-row), canonical N then S — the `THexagonDirection`
 *  enum tail (NORTH = 6, SOUTH = 7). */
const VERTICAL_STEP_OFFSETS: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [0, -1], // N
  [0, 1], // S
] as const;

/**
 * The terrain navigation graph: a width×height grid of HALF-CELL nodes (`2W×2H` for a `W×H`-cell
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

  /** The node id at (x, y). Throws if out of bounds — an out-of-range lookup is a programmer error. */
  nodeAt(x: number, y: number): NodeId {
    if (!this.inBounds(x, y))
      throw new Error(`node (${x}, ${y}) out of bounds (${this.width}x${this.height})`);
    return (y * this.width + x) as NodeId;
  }

  /** The (x, y) coordinates of a node id. */
  coordsOf(node: NodeId): { x: number; y: number } {
    return { x: node % this.width, y: Math.floor(node / this.width) };
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
    return (cy * this.width + cx) as NodeId;
  }

  /** The landscape typeId tagged on a node. Throws on an id outside the grid (programmer error). */
  typeAt(node: NodeId): number {
    const id = this.typeIds[node];
    if (id === undefined) throw new Error(`node id ${node} out of range (0..${this.nodeCount - 1})`);
    return id;
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

  /** Per-node capacity (how many units may cluster here). */
  maxValency(node: NodeId): number {
    return this.propsOf(node).maxValency;
  }

  /**
   * The in-bounds 4-connected neighbours of a node, in canonical N, E, S, W order. Border nodes
   * simply yield fewer neighbours. Deterministic: the order never depends on map history.
   */
  neighbours(node: NodeId): NodeId[] {
    const { x, y } = this.coordsOf(node);
    const out: NodeId[] = [];
    for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (this.inBounds(nx, ny)) out.push((ny * this.width + nx) as NodeId);
    }
    return out;
  }

  /**
   * The walkable subset of {@link neighbours} (4-connected), same canonical order. This is the
   * ADJACENCY relation for placement/valency, NOT the pathfinder's edge set — movement is
   * 8-connected via {@link steps}.
   */
  walkableNeighbours(node: NodeId): NodeId[] {
    return this.neighbours(node).filter((n) => this.isWalkable(n));
  }

  /**
   * The pathfinder's 8-direction edge set from `node` on the half-cell lattice: the E/W half-column
   * steps, then the four diagonal edges in canonical NE, SE, SW, NW screen-heading order, then the
   * two straight vertical half-row steps N, S (the enum tail of the original's `THexagonDirection`,
   * NORTH = 6, SOUTH = 7). Each step is paired with its fixed-point cost: the destination node's
   * {@link walkCost} × the edge's world length (E/W = {@link HALF_COLUMN}, diagonal =
   * {@link DIAGONAL_STEP} ≈ ¾, vertical = {@link HALF_ROW}) — so A* minimises TRUE on-screen
   * distance. `blocked` is the dynamic walk-block overlay (nodes standing buildings occupy); a step
   * onto a blocked or unwalkable node is omitted. E/W and N/S steps connect directly adjacent nodes,
   * so walkability is a property of the DESTINATION node (the original's vertex-graph movement
   * model). A DIAGONAL edge passes exactly between the two nodes flanking its midpoint (offsets
   * `(0, dy/2)` and `(dx, dy/2)`), so it additionally requires at least ONE of those flanks
   * passable: with both flanks blocked the seam is a wall joint, not a gap (the same rule the old
   * two-row vertical step carried — a named approximation, no readable movement source).
   *
   * Determinism: fixed emission order + fixed per-step costs, all `Fixed`; the returned list drives
   * the A* relaxation, so its order is part of the canonical path choice (pinned by the pathfinding
   * goldens).
   */
  steps(node: NodeId, blocked?: BlockOverlay): Array<{ node: NodeId; cost: Fixed }> {
    const { x, y } = this.coordsOf(node);
    const out: Array<{ node: NodeId; cost: Fixed }> = [];
    const passable = (nx: number, ny: number): boolean => {
      if (!this.inBounds(nx, ny)) return false;
      const c = (ny * this.width + nx) as NodeId;
      return this.isWalkable(c) && !(blocked?.has(c) ?? false);
    };
    // Half-column steps first, canonical E then W.
    for (const [dx, dy] of COLUMN_STEP_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!passable(nx, ny)) continue;
      const c = (ny * this.width + nx) as NodeId;
      out.push({ node: c, cost: fx.mul(this.walkCost(c), HALF_COLUMN) });
    }
    // Diagonal steps, canonical NE,SE,SW,NW — gated on the flanked midpoint seam.
    for (const [dx, dy] of DIAGONAL_STEP_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!passable(nx, ny)) continue;
      // The seam between two blocked flanks is a wall joint, not a walkable gap.
      const fy = y + dy / 2;
      if (!passable(x, fy) && !passable(nx, fy)) continue;
      const c = (ny * this.width + nx) as NodeId;
      out.push({ node: c, cost: fx.mul(this.walkCost(c), DIAGONAL_STEP) });
    }
    // Vertical half-row steps last, canonical N then S (the THexagonDirection tail order).
    for (const [dx, dy] of VERTICAL_STEP_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!passable(nx, ny)) continue;
      const c = (ny * this.width + nx) as NodeId;
      out.push({ node: c, cost: fx.mul(this.walkCost(c), HALF_ROW) });
    }
    return out;
  }

  /**
   * The STATIC-connectivity label of a node: nodes reachable from each other over static terrain
   * share a label; unwalkable nodes are -1. The dynamic walk-block overlay only ever REMOVES edges,
   * so two nodes with different labels are provably unreachable under ANY overlay — the pathfinder
   * uses this to answer "no route" without flooding the whole component (an island right-click used
   * to cost a full-map Dijkstra). Labels are assigned by ascending seed id at build time, so they
   * are a pure function of the terrain — lockstep-safe.
   */
  componentOf(node: NodeId): number {
    const label = this.components[node];
    if (label === undefined) throw new Error(`node id ${node} out of range (0..${this.nodeCount - 1})`);
    return label;
  }

  /** Flood-fill the static components over the pathfinder's own edge set ({@link steps} with no
   *  overlay), so the diagonal flank-seam rule has exactly one owner. Edges are symmetric within
   *  the walkable set (destination-walkability + the shared flank pair), so a BFS labelling is
   *  well-defined. One-time O(nodes) build cost. */
  private computeComponents(): Int32Array {
    const components = new Int32Array(this.nodeCount).fill(-1);
    const queue: number[] = [];
    let nextLabel = 0;
    for (let seed = 0; seed < this.nodeCount; seed++) {
      if (components[seed] !== -1 || !this.isWalkable(seed as NodeId)) continue;
      const label = nextLabel;
      nextLabel += 1;
      components[seed] = label;
      queue.length = 0;
      queue.push(seed);
      let head = 0;
      while (head < queue.length) {
        const cur = queue[head];
        head += 1;
        if (cur === undefined) break; // head < length ⇒ present; guard for the checked access
        for (const { node } of this.steps(cur as NodeId)) {
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
