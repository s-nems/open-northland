/**
 * The terrain CELL-ADJACENCY GRAPH — the sim's navigation model (docs/ECS.md, Phase 2).
 *
 * This is NOT the triangle render tessellation: navigation, pathfinding, and placement all operate
 * on a graph of cells. Each cell carries a landscape `typeId` (from the IR's {@link LandscapeType}
 * table) which resolves to walkability, a fixed-point walk cost, and a per-cell valency (capacity).
 *
 * DETERMINISM: the graph is a plain-data world resource (not entities). Cells are addressed by a
 * monotonic row-major id (`y * width + x`), and neighbours are emitted in a fixed canonical order
 * so traversal is byte-identical across runs — the precondition for A* with canonical tie-breaking
 * and lockstep replay. All costs are `Fixed`; no floats touch state.
 *
 * MOVEMENT has 8 DIRECTIONS ({@link TerrainGraph.steps}) — the original's STAGGERED-RASTER lattice
 * (source basis "projection": odd rows shifted half a cell right, 68×38 px pitch), where a cell's
 * true neighbours are E/W plus the four half-shifted cells one row up/down, PLUS a straight VERTICAL
 * step (N/S: two rows up/down, through the gap between the two flanking cells of the intermediate
 * row). The direction COUNT is PINNED, not inferred: the original's own source includes name the
 * movement direction type `THexagonDirection` with E/SE/SW/W/NW/NE = 0..5 **and NORTH = 6, SOUTH =
 * 7** (source basis "A* pathfinding" row) — and the walk animations carry all eight facing
 * blocks, N/S included, which only a vertical locomotion step would ever play. The vertical step's
 * exact SEMANTICS (two rows, flanked-gap passability) are approximated — no offset table survives in
 * the readable sources. WHICH grid offsets the row-crossers are depends on the row's parity (see
 * {@link LATTICE_ROW_STEPS}); a square-grid 8-neighbour reading would invent two "long diagonal"
 * edges per cell that the lattice doesn't have (the old zigzag routes) and mis-price the four real
 * ones. Edge costs are the edges' real world lengths in the lattice metric (`nav/metric.ts`): E/W =
 * ONE (a 68 px column step), row-crossing = {@link DIAGONAL_STEP} ≈ ¾·ONE (a 51 px lattice edge),
 * vertical = {@link VERTICAL_STEP} ≈ 1.118·ONE (a 76 px two-row drop) — so A* minimises true
 * on-screen distance, and a straight-vertical order routes straight instead of weaving NE/NW between
 * columns (the reported zigzag-going-up). The 4-connected {@link TerrainGraph.neighbours}/
 * {@link TerrainGraph.walkableNeighbours} remain for placement/valency adjacency, which is not a
 * movement question.
 */
import type { ContentSet, LandscapeType } from '@vinland/data';
import type { Brand } from '../core/brand.js';
import { type Fixed, ONE, fx } from '../core/fixed.js';
import { DIAGONAL_STEP, HALF_COLUMN, ROW_STEP, VERTICAL_STEP } from './metric.js';

/** A cell address: the row-major index `y * width + x`. Branded so a raw number can't stand in. */
export type CellId = Brand<number, 'CellId'>;

/** Canonical orthogonal neighbour offsets in N, E, S, W order — the fixed traversal order for determinism. */
const NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [0, -1], // N
  [1, 0], // E
  [0, 1], // S
  [-1, 0], // W
] as const;

/** The two COLUMN-STEP lattice edges (pure horizontal, one full cell width), canonical E then W. */
const COLUMN_STEP_OFFSETS: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [1, 0], // E
  [-1, 0], // W
] as const;

/** One lattice-step grid offset. */
type GridStep = readonly [dx: number, dy: number];

/**
 * The four ROW-CROSSING lattice edges per row parity, in canonical NE, SE, SW, NW screen-heading
 * order. Under the stagger (odd rows shifted half a cell right) the grid offset of "the cell half a
 * step up-right of me" depends on which row I stand on: from an EVEN row it is `(0,−1)` (the odd row
 * above is already shifted right), from an ODD row `(+1,−1)` — and mirrored for the other three. The
 * fixed order (after E/W) keeps expansion history-independent. Typed as exact 4-tuples so the
 * vertical-step flank lookup in {@link TerrainGraph.steps} can destructure them without an
 * undefined-check.
 */
const LATTICE_ROW_STEPS: readonly [
  even: readonly [ne: GridStep, se: GridStep, sw: GridStep, nw: GridStep],
  odd: readonly [ne: GridStep, se: GridStep, sw: GridStep, nw: GridStep],
] = [
  [
    [0, -1], // NE
    [0, 1], // SE
    [-1, 1], // SW
    [-1, -1], // NW
  ],
  [
    [1, -1], // NE
    [1, 1], // SE
    [0, 1], // SW
    [0, -1], // NW
  ],
] as const;

/** One vertical lattice step: two rows up/down (`dy` = ∓2) gated on its two flank cells' seam. */
type VerticalStep = readonly [dy: number, flankA: GridStep, flankB: GridStep];

/** Derive a parity's vertical steps from its row steps — the flanks of the N (S) seam are exactly
 *  the NE/NW (SE/SW) step targets, so the two tables can never drift apart. */
function verticalStepsOf(
  rowSteps: readonly [ne: GridStep, se: GridStep, sw: GridStep, nw: GridStep],
): readonly VerticalStep[] {
  const [ne, se, sw, nw] = rowSteps;
  return [
    [-2, nw, ne], // N — the gap between the NW and NE flank cells
    [2, sw, se], // S — the gap between the SW and SE flank cells
  ];
}

/**
 * The two VERTICAL lattice steps per row parity, canonical N then S (the `THexagonDirection` tail
 * order). Hoisted to a module table (like {@link LATTICE_ROW_STEPS}) so the hot A* expansion
 * allocates nothing to look them up.
 */
const VERTICAL_LATTICE_STEPS: readonly [even: readonly VerticalStep[], odd: readonly VerticalStep[]] = [
  verticalStepsOf(LATTICE_ROW_STEPS[0]),
  verticalStepsOf(LATTICE_ROW_STEPS[1]),
];

/** Resolved, sim-ready properties of one landscape type (derived once from the IR at build time). */
interface CellTypeProps {
  readonly walkable: boolean;
  /** Whether a building's reserved zone may cover a cell of this type. Distinct from `walkable`: a
   *  real map's margin band around a tree/rock is walkable ground you may not BUILD on, while water
   *  is neither. The build-placement rule reads this; navigation never does. */
  readonly buildable: boolean;
  /** Cost to step ONTO a cell of this type, in fixed-point. Walkable cells cost one unit. */
  readonly walkCost: Fixed;
  /** Per-cell capacity — how many units may cluster on a cell of this type (0 = unset/blocking). */
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
 * The terrain navigation graph: a width×height grid of cells, each tagged with a landscape typeId,
 * plus the resolved per-type properties. Construct via {@link buildTerrainGraph}.
 */
export class TerrainGraph {
  readonly width: number;
  readonly height: number;
  /** Row-major landscape typeId per cell (length === width*height). */
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

  /** Total cell count. */
  get cellCount(): number {
    return this.width * this.height;
  }

  /** True if (x, y) is inside the grid. */
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** The cell id at (x, y). Throws if out of bounds — an out-of-range lookup is a programmer error. */
  cellAt(x: number, y: number): CellId {
    if (!this.inBounds(x, y))
      throw new Error(`cell (${x}, ${y}) out of bounds (${this.width}x${this.height})`);
    return (y * this.width + x) as CellId;
  }

  /** The (x, y) coordinates of a cell id. */
  coordsOf(cell: CellId): { x: number; y: number } {
    return { x: cell % this.width, y: Math.floor(cell / this.width) };
  }

  /**
   * The cell containing integer tile coordinates (`x`, `y`), clamped into the grid. Unlike
   * {@link cellAt} this never throws — it is the navigation planner's seam from a settler's tile
   * position (already snapped to an integer cell centre by the MovementSystem) to a cell id, so an
   * out-of-range coordinate clamps to the nearest border cell rather than crashing a tick. Pass
   * integer tile coords (round a fixed-point Position with `fx.toInt` first); a fractional value is
   * truncated toward zero by the cell layout.
   */
  cellAtClamped(x: number, y: number): CellId {
    const cx = x < 0 ? 0 : x >= this.width ? this.width - 1 : x;
    const cy = y < 0 ? 0 : y >= this.height ? this.height - 1 : y;
    return (cy * this.width + cx) as CellId;
  }

  /** The landscape typeId tagged on a cell. Throws on an id outside the grid (programmer error). */
  typeAt(cell: CellId): number {
    const id = this.typeIds[cell];
    if (id === undefined) throw new Error(`cell id ${cell} out of range (0..${this.cellCount - 1})`);
    return id;
  }

  private propsOf(cell: CellId): CellTypeProps {
    return this.props.get(this.typeAt(cell)) ?? UNKNOWN_TYPE;
  }

  /** True if a unit may stand on / walk through this cell. */
  isWalkable(cell: CellId): boolean {
    return this.propsOf(cell).walkable;
  }

  /** True if a building's reserved zone may cover this cell (the landscape row's `buildable` flag —
   *  water/rock/void are neither walkable nor buildable; a real map's object margin is walkable but
   *  not buildable). Placement-only; navigation reads {@link isWalkable}. */
  isBuildable(cell: CellId): boolean {
    return this.propsOf(cell).buildable;
  }

  /** Fixed-point cost to step onto this cell. */
  walkCost(cell: CellId): Fixed {
    return this.propsOf(cell).walkCost;
  }

  /** Per-cell capacity (how many units may cluster here). */
  maxValency(cell: CellId): number {
    return this.propsOf(cell).maxValency;
  }

  /**
   * The in-bounds 4-connected neighbours of a cell, in canonical N, E, S, W order. Border cells
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
   * The pathfinder's 8-direction edge set from `cell` — the staggered lattice's real neighbourhood:
   * the E/W column steps, then the four row-crossing edges in canonical NE, SE, SW, NW screen-heading
   * order (their grid offsets depend on the row's parity — {@link LATTICE_ROW_STEPS}), then the two
   * straight VERTICAL steps N, S (two rows up/down, same world column — the enum tail of the
   * original's `THexagonDirection`, NORTH = 6, SOUTH = 7). Each step is paired with its fixed-point
   * cost: the destination cell's {@link walkCost} × the edge's world length (E/W = ONE, row-crossing
   * = {@link DIAGONAL_STEP} ≈ ¾, vertical = {@link VERTICAL_STEP} ≈ 1.118) — so A* minimises TRUE
   * on-screen distance. `blocked` is the dynamic walk-block overlay (cells standing buildings
   * occupy); a step onto a blocked or unwalkable cell is omitted. No corner-cut rule is needed on the
   * six short edges: the four row-crossing edges cross a full shared diamond edge (nothing to clip
   * through), and an E/W step passes a shared vertex between the two row-neighbours — walkability is
   * a property of the DESTINATION cell, the original's vertex-graph movement model. A VERTICAL step,
   * though, walks the seam BETWEEN the two intermediate-row cells that flank the line (exactly the
   * SE/SW — or NE/NW — step targets), so it additionally requires at least ONE of those flanks
   * passable: with both flanks blocked the seam is a wall joint, not a gap.
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
    // Column steps first, canonical E then W — cost is the destination's walk cost (edge length ONE).
    for (const [dx, dy] of COLUMN_STEP_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!passable(nx, ny)) continue;
      const c = (ny * this.width + nx) as CellId;
      out.push({ cell: c, cost: this.walkCost(c) });
    }
    // Row-crossing steps, canonical NE,SE,SW,NW — the parity-matched grid offsets; the step costs
    // the destination's walk cost × the lattice edge length (≈ ¾ of a column step).
    const rowSteps = (y & 1) === 1 ? LATTICE_ROW_STEPS[1] : LATTICE_ROW_STEPS[0];
    for (const [dx, dy] of rowSteps) {
      const nx = x + dx;
      const ny = y + dy;
      if (!passable(nx, ny)) continue;
      const c = (ny * this.width + nx) as CellId;
      out.push({ cell: c, cost: fx.mul(this.walkCost(c), DIAGONAL_STEP) });
    }
    // Vertical steps last, canonical N then S (the THexagonDirection tail order): two rows straight
    // up/down through the flanked gap ({@link VERTICAL_LATTICE_STEPS}).
    const verticals = (y & 1) === 1 ? VERTICAL_LATTICE_STEPS[1] : VERTICAL_LATTICE_STEPS[0];
    for (const [dy, flankA, flankB] of verticals) {
      const ny = y + dy;
      if (!passable(x, ny)) continue;
      // The seam between two blocked flanks is a wall joint, not a walkable gap.
      if (!passable(x + flankA[0], y + flankA[1]) && !passable(x + flankB[0], y + flankB[1])) continue;
      const c = (ny * this.width + x) as CellId;
      out.push({ cell: c, cost: fx.mul(this.walkCost(c), VERTICAL_STEP) });
    }
    return out;
  }
}

/** A raw terrain map: dimensions + a row-major landscape-typeId grid (the cell-graph input). */
export interface TerrainMap {
  readonly width: number;
  readonly height: number;
  /** Row-major landscape typeId per cell; length must equal width*height. */
  readonly typeIds: ReadonlyArray<number>;
}

/**
 * Build the cell-adjacency graph from the content's {@link LandscapeType} table and a terrain map.
 * The per-type props are resolved once here so per-cell lookups during a tick are pure array reads.
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

/** A fixed-point Manhattan-style step distance between two cells (4-connected metric). */
export function cellManhattanDistance(g: TerrainGraph, a: CellId, b: CellId): Fixed {
  const ca = g.coordsOf(a);
  const cb = g.coordsOf(b);
  return fx.fromInt(Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y));
}

/**
 * The extra cost of covering one HALF-COLUMN of sideways travel with a diagonal step instead of a
 * (half a) vertical one — {@link DIAGONAL_STEP} − {@link ROW_STEP}, the marginal price the
 * vertical-heavy branch of {@link cellLatticeDistance} pays per half-column of offset.
 */
const DIAGONAL_OVER_HALF_VERTICAL: Fixed = fx.sub(DIAGONAL_STEP, ROW_STEP);

/**
 * The fixed-point STAGGERED-LATTICE step distance between two cells — the admissible, consistent A*
 * heuristic for the 8-direction graph ({@link TerrainGraph.steps}: E/W cost ONE, row-crossing cost
 * {@link DIAGONAL_STEP}, vertical two-row cost {@link VERTICAL_STEP}). It is the EXACT minimum cost
 * across open terrain, split by which need dominates (`whx` = the world-x offset in half-columns,
 * `rows` = the row offset; the two always share parity, since a cell's half-column x has its row's
 * parity):
 *
 *  - `whx ≥ rows` (sideways dominates): every row-crossing is a diagonal sliding toward the goal
 *    (each absorbs one half-column), the remaining offset is E/W column steps —
 *    `rows·DIAGONAL_STEP + (whx − rows)·HALF_COLUMN`.
 *  - `whx < rows` (vertical dominates): `whx` diagonals cover the whole offset, the remaining
 *    `rows − whx` rows pair up into straight vertical steps —
 *    `whx·DIAGONAL_STEP + (rows − whx)·ROW_STEP`, computed as
 *    `rows·ROW_STEP + whx·(DIAGONAL_STEP − ROW_STEP)` (shared parity makes `rows − whx` even, so the
 *    verticals pair exactly).
 *
 * Both branches compose the very integers the edge costs are built from ({@link VERTICAL_STEP} is
 * defined as ROW_STEP doubled), so on unit-cost terrain the heuristic EQUALS the true open-terrain
 * graph distance — admissible and consistent by construction; obstacles only raise the true cost, so
 * A* stays optimal. Substituting E/W steps or opposing-diagonal pairs for sideways travel is never
 * cheaper (ONE > 2·(DIAGONAL_STEP − ROW_STEP) per column, and an opposing pair wastes its rows), so
 * no third case exists.
 */
export function cellLatticeDistance(g: TerrainGraph, a: CellId, b: CellId): Fixed {
  const ca = g.coordsOf(a);
  const cb = g.coordsOf(b);
  const rows = Math.abs(ca.y - cb.y);
  // World-x offset between the cell centres in integer HALF-COLUMNS: twice the column delta plus the
  // 0/1 stagger of each row's parity — exact plain integers, the same encoding the pathfinder's
  // line-deviation tie-break uses.
  const whx = Math.abs(2 * (cb.x - ca.x) + (cb.y & 1) - (ca.y & 1));
  if (whx >= rows) {
    // Sideways dominates: all rows cross diagonally, the leftover offset is full column steps.
    const columns = fx.mul(fx.fromInt(whx - rows), HALF_COLUMN);
    return fx.add(fx.mul(fx.fromInt(rows), DIAGONAL_STEP), columns);
  }
  // Vertical dominates: whx diagonals absorb the offset, the leftover rows pair into vertical steps.
  return fx.add(fx.mul(fx.fromInt(rows), ROW_STEP), fx.mul(fx.fromInt(whx), DIAGONAL_OVER_HALF_VERTICAL));
}
