import { type Container, Mesh, Texture } from 'pixi.js';
import type { SceneTerrain } from '../../data/scene/index.js';
import {
  type BrightnessField,
  type ElevationField,
  scaleColour,
  triangleANodes,
  triangleBNodes,
} from '../../data/terrain/index.js';
import { makeTintedTerrainShader } from '../shading.js';
import { emptyBatch, meshGeometry, type TerrainBatch, type TerrainChild } from './chunk-batcher.js';
import { buildChunks, flatTileColour, liftFn, positions, type TerrainChunk } from './geometry.js';

/** Shading levels per unit. The meshes batch by exact colour, so an unquantized gradient would
 *  explode the per-block mesh count; coarse banding is acceptable on a placeholder path. */
const FLAT_SHADE_STEPS = 8;

/**
 * The flat-tint placeholder ground: a single-type block is one draw call regardless of tile count. A
 * shaded map scales each cell's tint CPU-side.
 */
export function buildFlat(
  parent: Container,
  terrain: SceneTerrain,
  elevation: ElevationField,
  brightness: BrightnessField,
): TerrainChunk[] {
  const lift = liftFn(terrain, elevation);
  const shaded = brightness.shaded;
  return buildChunks(parent, terrain, elevation.maxLift, (c0, r0, c1, r1) => {
    const byColour = new Map<number, TerrainBatch>();
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const typeId = terrain.typeIds[row * terrain.width + col] ?? 0;
        const baseColour = flatTileColour(typeId);
        const colour = shaded
          ? scaleColour(
              baseColour,
              Math.round(brightness.brightnessAt(col, row) * FLAT_SHADE_STEPS) / FLAT_SHADE_STEPS,
            )
          : baseColour;
        let batch = byColour.get(colour);
        if (batch === undefined) {
          batch = emptyBatch();
          byColour.set(colour, batch);
        }
        for (const nodes of [triangleANodes(col, row), triangleBNodes(col, row)]) {
          const base = batch.positions.length / 2;
          batch.positions.push(...positions(nodes, lift));
          for (const [hx, hy] of nodes) batch.nodes.push(hx, hy);
          for (let v = 0; v < 3; v++) batch.uvs.push(0, 0); // every vertex samples the 1×1 white texel
          batch.indices.push(base, base + 1, base + 2);
        }
      }
    }
    const children: TerrainChild[] = [];
    for (const [colour, batch] of byColour) {
      const mesh = new Mesh({
        geometry: meshGeometry(batch),
        texture: Texture.WHITE,
        shader: makeTintedTerrainShader(Texture.WHITE.source),
      });
      mesh.tint = colour;
      children.push(mesh);
    }
    return children;
  });
}
