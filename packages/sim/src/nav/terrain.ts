/**
 * The terrain CELL-ADJACENCY GRAPH — the sim's navigation model (docs/ECS.md, Phase 2).
 *
 * This is NOT the triangle render tessellation: navigation, pathfinding, and placement all operate
 * on a graph of cells. Each cell carries a landscape `typeId` (from the IR's {@link LandscapeType}
 * table) which resolves to walkability, a fixed-point walk cost, and a per-cell valency (capacity).
 *
 * DETERMINISM: the graph is a plain-data world resource (not entities). Cells are addressed by a
 * monotonic row-major id (`y * width + x`), and neighbours are emitted in a fixed canonical order
 * (orthogonal N, E, S, W, then diagonal NE, SE, SW, NW) so traversal is byte-identical across runs —
 * the precondition for A* with canonical tie-breaking and lockstep replay. All costs are `Fixed`; no
 * floats touch state.
 *
 * The graph is 8-CONNECTED for pathfinding ({@link TerrainGraph.steps}): a settler may step
 * diagonally, so it walks toward a target in a straight line rather than an axis-aligned staircase
 * that reads as an "arc" once the iso projection skews it. Diagonals cost √2 (octile metric, so the
 * pathfinder minimises real distance) and forbid corner-cutting — a diagonal is legal only when both
 * shared orthogonal cells are themselves passable, so a unit never squeezes through a wall/building
 * corner. The 4-connected {@link TerrainGraph.neighbours}/{@link TerrainGraph.walkableNeighbours}
 * remain for placement/valency adjacency, which is not a movement question.
 */
import type { ContentSet, LandscapeType } from '@vinland/data';
import type { Brand } from '../core/brand.js';
import { type Fixed, ONE, fx } from '../core/fixed.js';

/** A cell address: the row-major index `y * width + x`. Branded so a raw number can't stand in. */
export type CellId = Brand<number, 'CellId'>;

/** Canonical orthogonal neighbour offsets in N, E, S, W order — the fixed traversal order for determinism. */
const NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [0, -1], // N
  [1, 0], // E
  [0, 1], // S
  [-1, 0], // W
] as const;

/**
 * Canonical diagonal neighbour offsets in NE, SE, SW, NW order, each paired with the two orthogonal
 * cells it "cuts between": a diagonal step is legal only when BOTH of those cells are passable, so a
 * settler can never clip through the corner of a wall or building (the standard no-corner-cut rule).
 * The fixed order (after the orthogonals) keeps 8-connected expansion history-independent.
 */
const DIAGONAL_OFFSETS: ReadonlyArray<{
  readonly dx: number;
  readonly dy: number;
  /** The two orthogonal corner cells (relative offsets) that must both be passable. */
  readonly corners: readonly [readonly [number, number], readonly [number, number]];
}> = [
  {
    dx: 1,
    dy: -1,
    corners: [
      [1, 0],
      [0, -1],
    ],
  }, // NE — needs E and N
  {
    dx: 1,
    dy: 1,
    corners: [
      [1, 0],
      [0, 1],
    ],
  }, // SE — needs E and S
  {
    dx: -1,
    dy: 1,
    corners: [
      [-1, 0],
      [0, 1],
    ],
  }, // SW — needs W and S
  {
    dx: -1,
    dy: -1,
    corners: [
      [-1, 0],
      [0, -1],
    ],
  }, // NW — needs W and N
] as const;

/**
 * Fixed-point √2 — the cost of a diagonal (8-connected) step relative to an orthogonal one (cost
 * ONE). Minted via {@link fx.isqrt} (the one sanctioned integer square root) so no `Math.sqrt` /
 * float touches sim state. Truncates slightly BELOW the true √2, which keeps the octile heuristic
 * admissible (it can only under-estimate the real cost). ≈ 1.41421·ONE.
 */
const SQRT2: Fixed = fx.isqrt(fx.fromInt(2));

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
   * The pathfinder's 8-connected edge set from `cell`: each walkable step (orthogonal N,E,S,W then
   * diagonal NE,SE,SW,NW, canonical) paired with its fixed-point cost — orthogonal = the destination
   * cell's {@link walkCost}, diagonal = that cost × √2 (the octile metric, so A* minimises real
   * distance and prefers a straight diagonal over an L-shaped detour). `blocked` is the dynamic
   * walk-block overlay (cells standing buildings occupy); a step onto a blocked or unwalkable cell is
   * omitted, and a DIAGONAL is emitted only when both shared orthogonal corner cells are themselves
   * passable — the no-corner-cut rule, so a unit never slips diagonally between two blockers.
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
    // Orthogonal steps first, canonical N,E,S,W — cost is the destination's walk cost.
    for (const [dx, dy] of NEIGHBOUR_OFFSETS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!passable(nx, ny)) continue;
      const c = (ny * this.width + nx) as CellId;
      out.push({ cell: c, cost: this.walkCost(c) });
    }
    // Diagonal steps, canonical NE,SE,SW,NW — legal only with both orthogonal corners passable; the
    // step costs √2× the destination's walk cost.
    for (const d of DIAGONAL_OFFSETS) {
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (!passable(nx, ny)) continue;
      const [[c0x, c0y], [c1x, c1y]] = d.corners;
      if (!passable(x + c0x, y + c0y) || !passable(x + c1x, y + c1y)) continue; // no corner-cutting
      const c = (ny * this.width + nx) as CellId;
      out.push({ cell: c, cost: fx.mul(this.walkCost(c), SQRT2) });
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
 * The fixed-point OCTILE distance between two cells — the admissible, consistent A* heuristic for the
 * 8-connected graph (orthogonal step cost ONE, diagonal cost √2). It is the exact minimum cost across
 * open terrain: take `min(dx,dy)` diagonal steps (each √2) toward alignment, then `|dx-dy|` orthogonal
 * steps for the remainder. With obstacles the true cost only rises, so this never over-estimates —
 * A* stays optimal. Mirrors the {@link SQRT2} step cost so the heuristic and edge costs agree.
 */
export function cellOctileDistance(g: TerrainGraph, a: CellId, b: CellId): Fixed {
  const ca = g.coordsOf(a);
  const cb = g.coordsOf(b);
  const dx = Math.abs(ca.x - cb.x);
  const dy = Math.abs(ca.y - cb.y);
  const lo = Math.min(dx, dy);
  const hi = Math.max(dx, dy);
  // (hi - lo) orthogonal steps at cost ONE + lo diagonal steps at cost √2.
  return fx.add(fx.fromInt(hi - lo), fx.mul(fx.fromInt(lo), SQRT2));
}
