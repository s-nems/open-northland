/**
 * The terrain CELL-ADJACENCY GRAPH — the sim's navigation model (docs/ECS.md, Phase 2).
 *
 * This is NOT the triangle render tessellation: navigation, pathfinding, and placement all operate
 * on a graph of cells. Each cell carries a landscape `typeId` (from the IR's {@link LandscapeType}
 * table) which resolves to walkability, a fixed-point walk cost, and a per-cell valency (capacity).
 *
 * DETERMINISM: the graph is a plain-data world resource (not entities). Cells are addressed by a
 * monotonic row-major id (`y * width + x`), and neighbours are emitted in a fixed canonical order
 * (N, E, S, W) so traversal is byte-identical across runs — the precondition for A* with canonical
 * tie-breaking and lockstep replay. All costs are `Fixed`; no floats touch state.
 */
import type { ContentSet, LandscapeType } from '@vinland/data';
import type { Brand } from './brand.js';
import { type Fixed, ONE, fx } from './fixed.js';

/** A cell address: the row-major index `y * width + x`. Branded so a raw number can't stand in. */
export type CellId = Brand<number, 'CellId'>;

/** Canonical neighbour offsets in N, E, S, W order — the fixed traversal order for determinism. */
const NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [dx: number, dy: number]> = [
  [0, -1], // N
  [1, 0], // E
  [0, 1], // S
  [-1, 0], // W
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
    // Uniform unit cost per walkable step for the Phase-2 slice; a per-type cost field can replace
    // this once landscapetypes.ini's movement weights are extracted into the IR. Stays Fixed so the
    // pathfinder never has to convert. Blocking cells keep a placeholder cost (never traversed).
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

  /** The walkable subset of {@link neighbours}, same canonical order — the pathfinder's edge set. */
  walkableNeighbours(cell: CellId): CellId[] {
    return this.neighbours(cell).filter((n) => this.isWalkable(n));
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

/** A fixed-point Manhattan-style step distance between two cells (for A* heuristics later). */
export function cellManhattanDistance(g: TerrainGraph, a: CellId, b: CellId): Fixed {
  const ca = g.coordsOf(a);
  const cb = g.coordsOf(b);
  return fx.fromInt(Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y));
}
