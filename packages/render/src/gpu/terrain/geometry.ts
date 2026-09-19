import { type BufferImageSource, Container } from 'pixi.js';
import { halfCellToScreen, TILE_HALF_H, TILE_HALF_W } from '../../data/projection/index.js';
import type { SceneTerrain } from '../../data/scene/index.js';
import { type ElevationField, type NodeXY, nodeLift, type WaterField } from '../../data/terrain/index.js';
import type { WaveUniforms } from '../shading.js';
import type { TerrainChild } from './chunk-batcher.js';

/**
 * Terrain is meshed in square blocks of this many tiles a side, and only blocks whose world-space box
 * meets the viewport are drawn. 32 keeps the visible-block count low while still culling tightly at the
 * screen edges.
 */
export const TERRAIN_CHUNK_TILES = 32;

/** A flat colour per landscape typeId for the placeholder terrain, cycled past the table's end.
 *  Indexed by the app's semantic terrain classes. The app keeps its `TERRAIN_CLASS_BASE` a multiple of
 *  this length so re-banded class ids still index back to their own colour; changing the length breaks
 *  that. */
const TILE_COLOURS: readonly number[] = [
  0x4a7c3a, // 0: grass (open)
  0x3a6ea5, // 1: water (impassable)
  0x8a6d3b, // 2: dirt/path (an object's body)
  0x9a9a9a, // 3: stone (margin)
  0xc9b26b, // 4: sand (barren - open ground crops can't be sown on)
];

export const DEFAULT_TILE_COLOUR = 0x4a7c3a;

/** The placeholder flat tint for a landscape typeId (`0xRRGGBB`), exported so a typeId→colour consumer
 *  with no palette of its own falls back to the ground's. */
export function flatTileColour(typeId: number): number {
  return TILE_COLOURS[typeId % TILE_COLOURS.length] ?? DEFAULT_TILE_COLOUR;
}

/** The flat tint of the most-common landscape typeId in a grid (`0xRRGGBB`); an empty grid gives the
 *  grass default. An approximation of the textured ground, used as an opaque backdrop. */
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

/** A node's upward lift in world px. */
export type NodeLiftFn = (hx: number, hy: number) => number;

export const NO_LIFT: NodeLiftFn = () => 0;

/** The map's shading and water inputs. `laneTexWidth` is the padded width, the brightness-lane `u`
 *  denominator. */
export interface LaneShading {
  readonly brightnessTex: BufferImageSource | undefined;
  readonly laneTexWidth: number;
  readonly water: WaterField;
  readonly waveUniforms: WaveUniforms;
}

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
 * One meshed terrain block: its display container plus the world-space AABB used to toggle `.visible`
 * against the viewport each frame. Children hold absolute world coords, so the box math and the sprite
 * cull share one coordinate space.
 */
export interface TerrainChunk {
  readonly container: Container;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Split the grid into {@link TERRAIN_CHUNK_TILES}-square blocks, handing `meshBlock` each block's
 * inclusive tile range. A block's AABB comes from its corner cells' triangle extents, so no per-cell
 * scan is needed. The block container stays at the world origin.
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
        // The lift only ever raises a vertex (−y) and the analytic box cannot see it, so extend the
        // top by the map-wide max so culling never clips ground baked up a hill.
        minY: r0 * TILE_HALF_H - maxLift,
        maxY: (r1 + 1) * TILE_HALF_H,
      });
    }
  }
  return chunks;
}
