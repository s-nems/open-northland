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
import type { ContentSet, LandscapeType } from '@vinland/data';

import { type NodeTypeProps, resolveTypeProps, TerrainGraph } from './graph.js';

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
  /** Never present — the inverse discriminant. A half-cell {@link TerrainMap} is otherwise a
   *  structural SUPERSET of this shape, so without it `halfCellMapFromCells(someHalfCellMap)`
   *  would compile and silently double-upsample to 4W×4H. */
  readonly resolution?: never;
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
  // The runtime twin of the `resolution?: never` discriminant, for callers that reach here past
  // the type system — double-upsampling a half-cell grid would silently misplace every node.
  if ((map as { resolution?: unknown }).resolution !== undefined) {
    throw new Error('halfCellMapFromCells expects a CELL-resolution grid, got a half-cell TerrainMap');
  }
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
  const props = new Map<number, NodeTypeProps>();
  for (const t of content.landscape) props.set(t.typeId, resolveTypeProps(t));

  const typeIds = Int32Array.from(map.typeIds);
  // Surface a content gap loudly rather than silently treating cells as blocking — a typeId in the
  // map with no matching LandscapeType is almost always a bad map/IR pairing the caller wants to know.
  for (const id of typeIds) {
    if (!props.has(id)) throw new Error(`terrain map references landscape typeId ${id} absent from content`);
  }
  return new TerrainGraph(map.width, map.height, typeIds, props);
}
