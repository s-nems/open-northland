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
 * MOVEMENT is 6-CONNECTED ({@link TerrainGraph.steps}) — the original's STAGGERED-RASTER lattice
 * (docs/FIDELITY.md "projection": odd rows shifted half a cell right, 68×38 px pitch), where a cell's
 * true neighbours are E/W plus the four half-shifted cells one row up/down. This is PINNED, not
 * inferred: the original's own source includes name the movement direction type `THexagonDirection`
 * with exactly these six primary directions, E/SE/SW/W/NW/NE = 0..5 (docs/FIDELITY.md "A* pathfinding"
 * row). WHICH grid offsets the four row-crossers are depends on the row's parity (see
 * {@link LATTICE_ROW_STEPS}); a square-grid 8-neighbour reading would invent two "long diagonal"
 * edges per cell that the lattice doesn't have (the old zigzag routes) and mis-price the four real
 * ones. Edge costs are the edges' real world lengths in the lattice metric (`nav/metric.ts`): E/W =
 * ONE (a 68 px column step), row-crossing = {@link DIAGONAL_STEP} ≈ ¾·ONE (a 51 px lattice edge) —
 * so A* minimises true on-screen distance. The 4-connected {@link TerrainGraph.neighbours}/
 * {@link TerrainGraph.walkableNeighbours} remain for placement/valency adjacency, which is not a
 * movement question.
 */
import type { ContentSet, LandscapeType } from '@vinland/data';
import type { Brand } from '../core/brand.js';
import { type Fixed, ONE, fx } from '../core/fixed.js';
import { DIAGONAL_STEP, HALF_COLUMN } from './metric.js';

/** Fixed-point zero, minted once — comparisons/fallbacks below need a branded zero. */
const ZERO: Fixed = fx.fromInt(0);

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

/**
 * The four ROW-CROSSING lattice edges per row parity, in canonical NE, SE, SW, NW screen-heading
 * order. Under the stagger (odd rows shifted half a cell right) the grid offset of "the cell half a
 * step up-right of me" depends on which row I stand on: from an EVEN row it is `(0,−1)` (the odd row
 * above is already shifted right), from an ODD row `(+1,−1)` — and mirrored for the other three. The
 * fixed order (after E/W) keeps expansion history-independent.
 */
const LATTICE_ROW_STEPS: readonly [
  even: ReadonlyArray<readonly [dx: number, dy: number]>,
  odd: ReadonlyArray<readonly [dx: number, dy: number]>,
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

/** Resolved, sim-ready properties of one landscape type (derived once from the IR at build time). */
interface CellTypeProps {
  readonly walkable: boolean;
  /** Cost to step ONTO a cell of this type, in fixed-point. Walkable cells cost one unit. */
  readonly walkCost: Fixed;
  /** Per-cell capacity — how many units may cluster on a cell of this type (0 = unset/blocking). */
  readonly maxValency: number;
}

/** Default props for a landscape typeId not present in the content table (treated as blocking). */
const UNKNOWN_TYPE: CellTypeProps = { walkable: false, walkCost: ONE, maxValency: 0 };

function resolveTypeProps(t: LandscapeType): CellTypeProps {
  return {
    walkable: t.walkable,
    // Walk cost is a uniform unit per walkable step — and that is FAITHFUL, not a placeholder:
    // `landscapetypes.ini` carries NO per-type movement weight (its only per-type numbers are
    // `maximumValency` = a per-cell capacity cap, and the `allowedon{land,water,everything}`
    // PLACEMENT-layer flags — neither is a traversal cost). The original engine gates movement by
    // walkability + valency, not a per-cell weight. A real cost field would need a source that has
    // one (e.g. a map tile-grid attribute), not this table. Stays Fixed so the pathfinder never
    // converts; blocking cells keep this cost but are never traversed.
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
   * The pathfinder's 6-connected edge set from `cell` — the staggered lattice's real neighbourhood:
   * the E/W column steps, then the four row-crossing edges in canonical NE, SE, SW, NW screen-heading
   * order (their grid offsets depend on the row's parity — {@link LATTICE_ROW_STEPS}). Each step is
   * paired with its fixed-point cost: the destination cell's {@link walkCost} × the edge's world
   * length (E/W = ONE, row-crossing = {@link DIAGONAL_STEP} ≈ ¾) — so A* minimises TRUE on-screen
   * distance. `blocked` is the dynamic walk-block overlay (cells standing buildings occupy); a step
   * onto a blocked or unwalkable cell is omitted. No corner-cut rule is needed on this lattice: the
   * four row-crossing edges cross a full shared diamond edge (nothing to clip through), and an E/W
   * step passes a shared vertex between the two row-neighbours — walkability is a property of the
   * DESTINATION cell, the original's vertex-graph movement model.
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
 * The fixed-point STAGGERED-LATTICE step distance between two cells — the admissible, consistent A*
 * heuristic for the 6-connected graph ({@link TerrainGraph.steps}: E/W cost ONE, row-crossing cost
 * {@link DIAGONAL_STEP}). It is the exact minimum cost across open terrain: `|Δrow|` row-crossing
 * steps are mandatory (only they change the row; each also slides half a column sideways), and
 * whatever WORLD-x offset they cannot absorb costs full column steps. Admissible because any path
 * needs ≥`|Δrow|` row-crossings and every extra row-crossing spent on sideways progress buys ≤ half
 * a column at cost {@link DIAGONAL_STEP} > ½·ONE — never cheaper than the bound. With obstacles the
 * true cost only rises, so A* stays optimal. Mirrors the {@link TerrainGraph.steps} costs so the
 * heuristic and edge costs agree.
 */
export function cellLatticeDistance(g: TerrainGraph, a: CellId, b: CellId): Fixed {
  const ca = g.coordsOf(a);
  const cb = g.coordsOf(b);
  const rows = Math.abs(ca.y - cb.y);
  // World-x offset between the cell centres, in column units: the column delta plus the half-column
  // stagger of each cell's row parity (integer rows, so the shift is 0 or exactly HALF_COLUMN).
  const wdx = fx.abs(
    fx.add(
      fx.fromInt(cb.x - ca.x),
      fx.sub((cb.y & 1) === 1 ? HALF_COLUMN : ZERO, (ca.y & 1) === 1 ? HALF_COLUMN : ZERO),
    ),
  );
  // The row-crossings absorb up to half a column of sideways travel each; the remainder is E/W steps.
  const absorbed = fx.mul(fx.fromInt(rows), HALF_COLUMN);
  const columns = wdx > absorbed ? fx.sub(wdx, absorbed) : ZERO;
  return fx.add(fx.mul(fx.fromInt(rows), DIAGONAL_STEP), columns);
}
