import type { ContentSet, LandscapeType } from '@open-northland/data';
import { TerrainGraph } from './graph.js';
import { type LandscapeProps, resolveLandscapeProps } from './landscape-props.js';
import type { LandscapeMapInput } from './landscapes.js';

/**
 * The graph input: a terrain map at half-cell resolution. `resolution` is a compile-time discriminant
 * so a cell-resolution grid can never reach the graph unscaled, only through
 * {@link halfCellMapFromCells}.
 */
export interface TerrainMap {
  readonly resolution: 'half-cell';
  readonly landscapes?: LandscapeMapInput;
  /** Ground vertex land mask, row-major on the half-cell grid. */
  readonly landVertices?: readonly boolean[];
  /** Original `lmco` connectivity id at each half-cell node. */
  readonly waterContinents?: readonly number[];
  /** Authored fish-manager rows, already addressed on this half-cell grid. */
  readonly fishSwarms?: readonly FishSwarmInput[] | undefined;
  /** Half-cell grid width, twice the map's cell columns. */
  readonly width: number;
  /** Half-cell grid height, twice the map's cell rows. */
  readonly height: number;
  /** Row-major landscape typeId per half-cell; length must equal width*height. */
  readonly typeIds: ReadonlyArray<number>;
}

export interface FishSwarmInput {
  readonly hx: number;
  readonly hy: number;
  readonly count: number;
  readonly continent: number;
}

/** A terrain grid authored at visual-cell resolution. Upsample through {@link halfCellMapFromCells}
 *  before building a graph. */
export interface CellTerrainMap {
  /** The inverse discriminant. A half-cell {@link TerrainMap} is otherwise a structural superset of
   *  this shape, so without it `halfCellMapFromCells(someHalfCellMap)` would compile and silently
   *  double-upsample. */
  readonly resolution?: never;
  readonly width: number;
  readonly height: number;
  /** Row-major landscape typeId per cell; length must equal width*height. */
  readonly typeIds: ReadonlyArray<number>;
  readonly fishSwarms?: readonly FishSwarmInput[] | undefined;
  readonly waterContinents?: readonly number[] | undefined;
}

/**
 * Upsample a cell-resolution grid to the half-cell lattice: cell `(x, y)` stamps its typeId onto the
 * 2x2 half-cell block `(2x..2x+1, 2y..2y+1)`. Source basis: the mapdat lane layout gives cell `(x, y)`
 * exactly that block.
 */
export function halfCellMapFromCells(map: CellTerrainMap): TerrainMap {
  // The runtime twin of the `resolution?: never` discriminant, for callers arriving past the types.
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
  return {
    resolution: 'half-cell',
    width,
    height,
    typeIds,
    ...(map.waterContinents !== undefined ? { waterContinents: map.waterContinents } : {}),
    ...(map.fishSwarms !== undefined ? { fishSwarms: map.fishSwarms } : {}),
  };
}

/**
 * Build the half-cell adjacency graph from the content's {@link LandscapeType} table and a half-cell
 * terrain map. The per-type props are resolved once here, so a per-node lookup during a tick is one map
 * hit instead of a scan of the content table.
 */
export function buildTerrainGraph(content: ContentSet, map: TerrainMap): TerrainGraph {
  const props = new Map<number, LandscapeProps>();
  for (const t of content.landscape) props.set(t.typeId, resolveLandscapeProps(t));

  const typeIds = Int32Array.from(map.typeIds);
  // A typeId with no matching LandscapeType means a bad map and IR pairing; fail rather than silently
  // treating those nodes as blocking.
  for (const id of typeIds) {
    if (!props.has(id)) throw new Error(`terrain map references landscape typeId ${id} absent from content`);
  }
  return new TerrainGraph(
    map.width,
    map.height,
    typeIds,
    props,
    map.landscapes,
    map.landVertices,
    map.waterContinents,
  );
}
