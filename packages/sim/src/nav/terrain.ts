/**
 * The terrain HALF-CELL ADJACENCY GRAPH — the sim's navigation model (docs/ECS.md, Phase 2).
 *
 * This is NOT the triangle render tessellation: navigation, pathfinding, and placement all operate
 * on a graph of HALF-CELLS — the original's `2W×2H` logic lattice. That resolution is pinned by the
 * data, not invented: the decoded map's object lanes (`lmlt`/`emla`/`lmlv`), `map.cif` StaticObjects
 * placements, and the `LogicWalkBlockArea`/`LogicBuildBlockArea` footprint offsets all address a
 * `2W×2H` grid (source basis: mapdat lane layout, OpenVikings format oracle). Each node carries a
 * landscape `typeId` (from the IR's {@link LandscapeType} table) which resolves to walkability, a
 * fixed-point walk cost, and a per-node valency (capacity).
 *
 * GEOMETRY: in half-cell coordinates the staggered raster becomes a PLAIN RECTANGULAR lattice —
 * node `(hx, hy)` sits at world `(hx·½ column, hy·½ row)` = (34 px, 19 px) pitch under the measured
 * 68×38 px projection, with the visual stagger arising from which nodes the cell centres occupy
 * (cell `(c, r)` = node `(2c + (r&1), 2r)`). So the old parity-dependent offset tables vanish: every
 * node has the SAME neighbour offsets.
 *
 * MOVEMENT keeps the original's 8 directions (`THexagonDirection`: E/SE/SW/W/NW/NE plus NORTH = 6,
 * SOUTH = 7 — source basis "A* pathfinding" row), now one half-cell fine ({@link TerrainGraph.steps}):
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
import type { ContentSet, LandscapeType } from '@vinland/data';
import type { Brand } from '../core/brand.js';
import { type Fixed, ONE, ZERO, fx } from '../core/fixed.js';
import { DIAGONAL_STEP, HALF_COLUMN, HALF_ROW } from './metric.js';

/** A half-cell node address: the row-major index `hy * width + hx`. Branded so a raw number can't
 *  stand in. (Named CellId for continuity — a nav "cell" IS a half-cell of the visual tile.) */
export type CellId = Brand<number, 'CellId'>;

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

/** Resolved, sim-ready properties of one landscape type (derived once from the IR at build time). */
interface CellTypeProps {
  readonly walkable: boolean;
  /** Whether a building's reserved zone may cover a node of this type. Distinct from `walkable`: a
   *  real map's margin band around a tree/rock is walkable ground you may not BUILD on, while water
   *  is neither. The build-placement rule reads this; navigation never does. */
  readonly buildable: boolean;
  /** Cost to step ONTO a node of this type, in fixed-point. Walkable nodes cost one unit. */
  readonly walkCost: Fixed;
  /** Per-node capacity — how many units may cluster on a node of this type (0 = unset/blocking). */
  readonly maxValency: number;
}

/** Default props for a landscape typeId not present in the content table (treated as blocking). */
const UNKNOWN_TYPE: CellTypeProps = { walkable: false, buildable: false, walkCost: ONE, maxValency: 0 };

function resolveTypeProps(t: LandscapeType): CellTypeProps {
  return {
    walkable: t.walkable,
    buildable: t.buildable,
    // Walk cost is a uniform unit per walkable step — faithful for THIS table:
    // `landscapetypes.ini` carries NO per-type movement weight (its only per-type numbers are
    // `maximumValency` = a per-cell capacity cap, and the `allowedon{land,water,everything}`
    // PLACEMENT-layer flags — neither is a traversal cost). The original DOES weight movement by
    // GROUND class, though: `trianglepatterntypes.cif` carries per-logicType `moveresistance`
    // (land 2, sand 3, mountain 4, snow 5 — now emitted as the IR's `trianglePatternTypes`); a
    // ground-class walk-cost is a future step, not this landscape-object table's field. Stays Fixed
    // so the pathfinder never converts; blocking cells keep this cost but are never traversed.
    walkCost: ONE,
    maxValency: t.maxValency,
  };
}

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
  private readonly props: ReadonlyMap<number, CellTypeProps>;

  constructor(width: number, height: number, typeIds: Int32Array, props: ReadonlyMap<number, CellTypeProps>) {
    if (width <= 0 || height <= 0) throw new Error(`terrain dimensions must be positive: ${width}x${height}`);
    if (typeIds.length !== width * height) {
      throw new Error(
        `terrain grid has ${typeIds.length} cells, expected ${width * height} (${width}x${height})`,
      );
    }
    this.width = width;
    this.height = height;
    this.typeIds = typeIds;
    this.props = props;
  }

  /** Total node count. */
  get cellCount(): number {
    return this.width * this.height;
  }

  /** True if (x, y) is inside the grid. */
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** The node id at (x, y). Throws if out of bounds — an out-of-range lookup is a programmer error. */
  cellAt(x: number, y: number): CellId {
    if (!this.inBounds(x, y))
      throw new Error(`cell (${x}, ${y}) out of bounds (${this.width}x${this.height})`);
    return (y * this.width + x) as CellId;
  }

  /** The (x, y) coordinates of a node id. */
  coordsOf(cell: CellId): { x: number; y: number } {
    return { x: cell % this.width, y: Math.floor(cell / this.width) };
  }

  /**
   * The node at integer half-cell coordinates (`x`, `y`), clamped into the grid. Unlike
   * {@link cellAt} this never throws — it is the navigation planner's seam from an entity's node
   * address (`nodeOfPosition`) to a node id, so an out-of-range coordinate clamps to the nearest
   * border node rather than crashing a tick.
   */
  cellAtClamped(x: number, y: number): CellId {
    const cx = x < 0 ? 0 : x >= this.width ? this.width - 1 : x;
    const cy = y < 0 ? 0 : y >= this.height ? this.height - 1 : y;
    return (cy * this.width + cx) as CellId;
  }

  /** The landscape typeId tagged on a node. Throws on an id outside the grid (programmer error). */
  typeAt(cell: CellId): number {
    const id = this.typeIds[cell];
    if (id === undefined) throw new Error(`cell id ${cell} out of range (0..${this.cellCount - 1})`);
    return id;
  }

  private propsOf(cell: CellId): CellTypeProps {
    return this.props.get(this.typeAt(cell)) ?? UNKNOWN_TYPE;
  }

  /** True if a unit may stand on / walk through this node. */
  isWalkable(cell: CellId): boolean {
    return this.propsOf(cell).walkable;
  }

  /** True if a building's reserved zone may cover this node (the landscape row's `buildable` flag —
   *  water/rock/void are neither walkable nor buildable; a real map's object margin is walkable but
   *  not buildable). Placement-only; navigation reads {@link isWalkable}. */
  isBuildable(cell: CellId): boolean {
    return this.propsOf(cell).buildable;
  }

  /** Fixed-point cost to step onto this node. */
  walkCost(cell: CellId): Fixed {
    return this.propsOf(cell).walkCost;
  }

  /** Per-node capacity (how many units may cluster here). */
  maxValency(cell: CellId): number {
    return this.propsOf(cell).maxValency;
  }

  /**
   * The in-bounds 4-connected neighbours of a node, in canonical N, E, S, W order. Border nodes
   * simply yield fewer neighbours. Deterministic: the order never depends on map history.
   */
  neighbours(cell: CellId): CellId[] {
    const { x, y } = this.coordsOf(cell);
    const out: CellId[] = [];
    for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (this.inBounds(nx, ny)) out.push((ny * this.width + nx) as CellId);
    }
    return out;
  }

  /**
   * The walkable subset of {@link neighbours} (4-connected), same canonical order. This is the
   * ADJACENCY relation for placement/valency, NOT the pathfinder's edge set — movement is
   * 8-connected via {@link steps}.
   */
  walkableNeighbours(cell: CellId): CellId[] {
    return this.neighbours(cell).filter((n) => this.isWalkable(n));
  }

  /**
   * The pathfinder's 8-direction edge set from `cell` on the half-cell lattice: the E/W half-column
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
  steps(cell: CellId, blocked?: ReadonlySet<CellId>): Array<{ cell: CellId; cost: Fixed }> {
    const { x, y } = this.coordsOf(cell);
    const out: Array<{ cell: CellId; cost: Fixed }> = [];
    const passable = (nx: number, ny: number): boolean => {
      if (!this.inBounds(nx, ny)) return false;
      const c = (ny * this.width + nx) as CellId;
      return this.isWalkable(c) && !(blocked?.has(c) ?? false);
    };
    // Half-column steps first, canonical E then W.
    for (const [dx, dy] of COLUMN_STEP_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!passable(nx, ny)) continue;
      const c = (ny * this.width + nx) as CellId;
      out.push({ cell: c, cost: fx.mul(this.walkCost(c), HALF_COLUMN) });
    }
    // Diagonal steps, canonical NE,SE,SW,NW — gated on the flanked midpoint seam.
    for (const [dx, dy] of DIAGONAL_STEP_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!passable(nx, ny)) continue;
      // The seam between two blocked flanks is a wall joint, not a walkable gap.
      const fy = y + dy / 2;
      if (!passable(x, fy) && !passable(nx, fy)) continue;
      const c = (ny * this.width + nx) as CellId;
      out.push({ cell: c, cost: fx.mul(this.walkCost(c), DIAGONAL_STEP) });
    }
    // Vertical half-row steps last, canonical N then S (the THexagonDirection tail order).
    for (const [dx, dy] of VERTICAL_STEP_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!passable(nx, ny)) continue;
      const c = (ny * this.width + nx) as CellId;
      out.push({ cell: c, cost: fx.mul(this.walkCost(c), HALF_ROW) });
    }
    return out;
  }
}

/**
 * A terrain map at HALF-CELL resolution: dimensions + a row-major landscape-typeId grid — the
 * graph input. `resolution` is a compile-time discriminant so a cell-resolution grid (a scene's
 * authored `W×H` strip, a decoded map's baked per-cell lane) can never reach the graph unscaled —
 * route those through {@link halfCellMapFromCells}.
 */
export interface TerrainMap {
  readonly resolution: 'half-cell';
  /** Half-cell grid width — 2× the map's cell columns. */
  readonly width: number;
  /** Half-cell grid height — 2× the map's cell rows. */
  readonly height: number;
  /** Row-major landscape typeId per half-cell; length must equal width*height. */
  readonly typeIds: ReadonlyArray<number>;
}

/** A terrain grid authored at VISUAL-CELL resolution (`W×H`) — scenes and the decoded map's baked
 *  per-cell lane. Upsample via {@link halfCellMapFromCells} before building a graph. */
export interface CellTerrainMap {
  readonly width: number;
  readonly height: number;
  /** Row-major landscape typeId per cell; length must equal width*height. */
  readonly typeIds: ReadonlyArray<number>;
}

/**
 * Upsample a cell-resolution grid to the half-cell lattice: cell `(x, y)` stamps its typeId onto
 * the 2×2 half-cell block `(2x..2x+1, 2y..2y+1)` — the SAME block convention the original's
 * half-cell lanes use (source basis: mapdat lane layout — cell (x,y) owns exactly that block).
 */
export function halfCellMapFromCells(map: CellTerrainMap): TerrainMap {
  if (map.typeIds.length !== map.width * map.height) {
    throw new Error(
      `cell grid has ${map.typeIds.length} cells, expected ${map.width * map.height} (${map.width}x${map.height})`,
    );
  }
  const width = map.width * 2;
  const height = map.height * 2;
  const typeIds = new Array<number>(width * height);
  for (let cy = 0; cy < map.height; cy++) {
    for (let cx = 0; cx < map.width; cx++) {
      const t = map.typeIds[cy * map.width + cx];
      if (t === undefined) throw new Error(`cell grid missing typeId at (${cx}, ${cy})`); // length-checked above
      const base = cy * 2 * width + cx * 2;
      typeIds[base] = t;
      typeIds[base + 1] = t;
      typeIds[base + width] = t;
      typeIds[base + width + 1] = t;
    }
  }
  return { resolution: 'half-cell', width, height, typeIds };
}

/**
 * Build the half-cell adjacency graph from the content's {@link LandscapeType} table and a
 * half-cell terrain map. The per-type props are resolved once here so per-node lookups during a
 * tick are pure array reads.
 */
export function buildTerrainGraph(content: ContentSet, map: TerrainMap): TerrainGraph {
  const props = new Map<number, CellTypeProps>();
  for (const t of content.landscape) props.set(t.typeId, resolveTypeProps(t));

  const typeIds = Int32Array.from(map.typeIds);
  // Surface a content gap loudly rather than silently treating cells as blocking — a typeId in the
  // map with no matching LandscapeType is almost always a bad map/IR pairing the caller wants to know.
  for (const id of typeIds) {
    if (!props.has(id)) throw new Error(`terrain map references landscape typeId ${id} absent from content`);
  }
  return new TerrainGraph(map.width, map.height, typeIds, props);
}

/**
 * The fixed-point HALF-CELL LATTICE step distance between two nodes — the admissible, consistent A*
 * heuristic for the 8-direction graph ({@link TerrainGraph.steps}: E/W cost {@link HALF_COLUMN},
 * diagonal cost {@link DIAGONAL_STEP}, vertical cost {@link HALF_ROW}). It is the EXACT minimum
 * cost across open terrain. With `ax = |Δhx|` (half-columns) and `ay = |Δhy|` (half-rows): a
 * diagonal covers `(1, 2)` and is cheaper than its straight substitute `E + 2·N`
 * (DIAGONAL_STEP < HALF_COLUMN + 2·HALF_ROW), so use as many diagonals as either axis allows —
 * `d = min(ax, ⌊ay/2⌋)` — and cover the remainder with straight steps:
 *
 *  - `2·ax ≤ ay` (vertical dominates): `ax·DIAGONAL_STEP + (ay − 2ax)·HALF_ROW`;
 *  - otherwise (sideways dominates): `⌊ay/2⌋·DIAGONAL_STEP + (ax − ⌊ay/2⌋)·HALF_COLUMN +
 *    (ay mod 2)·HALF_ROW`.
 *
 * No wasteful composition beats it: a zigzag diagonal pair covering one column costs
 * 2·DIAGONAL_STEP > 2·HALF_COLUMN, an opposing pair covering four rows costs 2·DIAGONAL_STEP >
 * 4·HALF_ROW, and a diagonal-plus-backtrack substitute for one E step costs DIAGONAL_STEP +
 * 2·HALF_ROW > HALF_COLUMN. Every term composes the very integers the edge costs are built from,
 * so on unit-cost terrain the heuristic EQUALS the true open-terrain graph distance — admissible
 * and consistent by construction; obstacles only raise the true cost, so A* stays optimal.
 */
export function cellLatticeDistance(g: TerrainGraph, a: CellId, b: CellId): Fixed {
  const ca = g.coordsOf(a);
  const cb = g.coordsOf(b);
  const ax = Math.abs(cb.x - ca.x);
  const ay = Math.abs(cb.y - ca.y);
  if (2 * ax <= ay) {
    // Vertical dominates: every half-column crosses diagonally, the leftover rows are half-row steps.
    return fx.add(fx.mul(fx.fromInt(ax), DIAGONAL_STEP), fx.mul(fx.fromInt(ay - 2 * ax), HALF_ROW));
  }
  // Sideways dominates: ⌊ay/2⌋ diagonals absorb the rows (one half-row may remain when ay is odd),
  // the leftover offset is half-column steps.
  const d = ay >> 1;
  const straight = fx.mul(fx.fromInt(ax - d), HALF_COLUMN);
  const oddRow = (ay & 1) === 1 ? HALF_ROW : ZERO;
  return fx.add(fx.add(fx.mul(fx.fromInt(d), DIAGONAL_STEP), straight), oddRow);
}
