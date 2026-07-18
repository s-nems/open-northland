import { type BufferImageSource, Container } from 'pixi.js';
import { halfCellToScreen, TILE_HALF_H, TILE_HALF_W } from '../../data/projection/index.js';
import type { SceneTerrain } from '../../data/scene/index.js';
import { type ElevationField, type NodeWaveFn, type NodeXY, nodeLift } from '../../data/terrain/index.js';
import type { WaveUniforms } from '../shading.js';
import type { TerrainChild } from './chunk-batcher.js';

/**
 * The shared terrain-mesh geometry: the per-node lift, the triangle vertex projection, the chunk driver
 * that splits the grid into culled blocks, and the placeholder tile-colour table. The two build
 * strategies ({@link import('./build-ground.js')} textured / {@link import('./build-flat.js')} flat) and
 * the retained {@link import('./terrain-layer.js').TerrainLayer} all sit on these primitives.
 */

/**
 * Terrain is meshed in square blocks of this many tiles a side, and each frame only the blocks whose
 * world-space box meets the viewport are drawn. 32 keeps the visible-block count (≈ draw calls) low
 * while still culling tightly at the screen edges. Exported because the decor/tall map-object blocks
 * ({@link import('../map-objects/index.js').MapObjectLayer}) deliberately partition world space at the
 * same scale, so the two layers cull in lockstep.
 */
export const TERRAIN_CHUNK_TILES = 32;

/** A flat colour per landscape typeId for the placeholder terrain (cycled if a typeId exceeds the table).
 *  Indexed by the semantic terrain classes (app `catalog/terrain.ts`): open/impassable/blocked/margin/barren.
 *  The app keeps its `TERRAIN_CLASS_BASE` a multiple of this length so the re-banded class ids still index
 *  back to their own colour here (`flatTileColour(base + k) === TILE_COLOURS[k]`); keep that in mind if the
 *  table's length changes. */
const TILE_COLOURS: readonly number[] = [
  0x4a7c3a, // 0: grass (open)
  0x3a6ea5, // 1: water (impassable)
  0x8a6d3b, // 2: dirt/path (an object's body)
  0x9a9a9a, // 3: stone (margin)
  0xc9b26b, // 4: sand (barren — open ground crops can't be sown on)
];

/** The default flat tint for an unbound landscape typeId (the fallback triangle's colour). */
export const DEFAULT_TILE_COLOUR = 0x4a7c3a;

/**
 * The placeholder flat tint for a landscape typeId (`0xRRGGBB`) — the same table the flat-tint ground
 * path batches by, exported so other typeId→colour consumers (the app's minimap raster) fall back to
 * the exact colours the placeholder ground draws instead of re-inventing a palette.
 */
export function flatTileColour(typeId: number): number {
  return TILE_COLOURS[typeId % TILE_COLOURS.length] ?? DEFAULT_TILE_COLOUR;
}

/**
 * The flat tint of the most-common landscape typeId in a grid (`0xRRGGBB`), via {@link flatTileColour}.
 * The portrait inset clears to it so a building framed past the map edge blends into the map's dominant
 * ground; an approximation of the textured ground, so it need not be exact. Empty grid → the grass default.
 */
export function dominantGroundColour(typeIds: readonly number[]): number {
  const counts = new Map<number, number>();
  let best: number | undefined;
  let bestCount = 0;
  for (const id of typeIds) {
    const n = (counts.get(id) ?? 0) + 1;
    counts.set(id, n);
    if (n > bestCount) {
      bestCount = n;
      best = id;
    }
  }
  return best === undefined ? DEFAULT_TILE_COLOUR : flatTileColour(best);
}

/** A node's upward lift in world px — 0 on a flat map, per-node elevation otherwise. */
export type NodeLiftFn = (hx: number, hy: number) => number;

/** No lift — the flat map's shared {@link NodeLiftFn}. */
export const NO_LIFT: NodeLiftFn = () => 0;

/** The map's shading + water inputs the mesh emitters thread to {@link pushTriangle}: the R8 lane
 *  texture (undefined → unshaded), its padded width (the brightness-lane `u` denominator), the
 *  per-node wave amplitude field (`data/terrain/water.ts`; NO_WAVE on land maps), and the map's ONE shared
 *  water-animation uniform group every shaded mesh binds. */
export interface LaneShading {
  readonly brightnessTex: BufferImageSource | undefined;
  readonly laneTexWidth: number;
  readonly wave: NodeWaveFn;
  readonly waveUniforms: WaveUniforms;
}

/** The per-node lift for this map: 0 everywhere on a flat field, else the node's own cell's lift with
 *  the map-border ring clamped to 0 (`data/terrain/tessellation.ts` `nodeLift`). */
export function liftFn(terrain: SceneTerrain, elevation: ElevationField): NodeLiftFn {
  if (elevation.maxLift <= 0) return NO_LIFT;
  return (hx, hy) => nodeLift(elevation.liftAt, hx, hy, terrain.width, terrain.height);
}

/** One triangle's 3 lifted vertex positions (flat `[x0,y0, …]`, world px) from its lattice nodes. */
export function positions(nodes: readonly [NodeXY, NodeXY, NodeXY], lift: NodeLiftFn): number[] {
  const out: number[] = [];
  for (const [hx, hy] of nodes) {
    const p = halfCellToScreen(hx, hy);
    out.push(p.x, p.y - lift(hx, hy));
  }
  return out;
}

/**
 * One meshed terrain block: its display {@link Container} (built once) plus the world-space AABB used to
 * toggle `.visible` against the viewport each frame. Children hold absolute world coords (the container
 * sits at the origin), so the box math and the sprite cull share one coordinate space.
 */
export interface TerrainChunk {
  readonly container: Container;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Drive the chunked build: split the grid into {@link TERRAIN_CHUNK_TILES}-square blocks, hand each
 * block's inclusive tile range to `meshBlock`, wrap the display objects it returns in one {@link
 * Container} (kept at the world origin, so children stay in absolute world coords), record the block's
 * AABB, add it under `parent`, and return the meshed blocks. Empty blocks are skipped. The box is
 * computed analytically from the block's corner cells' triangle extents — a cell's triangles span nodes
 * from `hx−1` to `hx+2` and rows `hy..hy+2` (`x ∈ [(2c−1)·halfW, (2c+3)·halfW]`, `y ∈ [r·rowStep,
 * (r+1)·rowStep]`) — so no per-cell scan is needed to know where a block lives on screen.
 */
export function buildChunks(
  parent: Container,
  terrain: SceneTerrain,
  maxLift: number,
  meshBlock: (c0: number, r0: number, c1: number, r1: number) => TerrainChild[],
): TerrainChunk[] {
  const chunks: TerrainChunk[] = [];
  for (let r0 = 0; r0 < terrain.height; r0 += TERRAIN_CHUNK_TILES) {
    for (let c0 = 0; c0 < terrain.width; c0 += TERRAIN_CHUNK_TILES) {
      const c1 = Math.min(c0 + TERRAIN_CHUNK_TILES, terrain.width) - 1;
      const r1 = Math.min(r0 + TERRAIN_CHUNK_TILES, terrain.height) - 1;
      const children = meshBlock(c0, r0, c1, r1);
      if (children.length === 0) continue;
      const container = new Container();
      for (const child of children) container.addChild(child);
      parent.addChild(container);
      chunks.push({
        container,
        minX: (2 * c0 - 1) * TILE_HALF_W,
        maxX: (2 * c1 + 3) * TILE_HALF_W,
        // The lift only ever raises a vertex (−y), so extend the box's top by the map-wide-max lift so
        // culling never clips a chunk whose meshed ground was baked up a hill (the analytic AABB can't
        // see the baked lift). `maxLift` is 0 for a flat field → the box is unchanged.
        minY: r0 * TILE_HALF_H - maxLift,
        maxY: (r1 + 1) * TILE_HALF_H,
      });
    }
  }
  return chunks;
}
