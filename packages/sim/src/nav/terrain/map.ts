/**
 * Terrain map inputs and graph construction: the {@link TerrainMap} half-cell grid, the
 * cell-resolution {@link CellTerrainMap} and its {@link halfCellMapFromCells} upsampler, and
 * {@link buildTerrainGraph}. See {@link TerrainGraph} for the lattice geometry and movement model.
 */
import type { ContentSet, LandscapeType } from '@open-northland/data';

import { TerrainGraph } from './graph.js';
import { type NodeTypeProps, resolveTypeProps } from './node-types.js';

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
