import { type Container, Mesh, Texture } from 'pixi.js';
import { type BrightnessField, scaleColour } from '../../data/brightness.js';
import type { ElevationField } from '../../data/elevation.js';
import type { SceneTerrain } from '../../data/scene/index.js';
import { triangleANodes, triangleBNodes } from '../../data/terrain.js';
import { emptyBatch, meshGeometry, type TerrainBatch } from './chunk-batcher.js';
import { buildChunks, flatTileColour, liftFn, positions, type TerrainChunk } from './geometry.js';

/**
 * Quantization steps for the flat placeholder's CPU-side shading: its meshes batch by exact colour,
 * so the multiplier snaps to this many levels per unit to keep the per-block mesh count bounded (a
 * placeholder path — coarse banding is acceptable, hundreds of one-cell meshes are not).
 */
const FLAT_SHADE_STEPS = 8;

/**
 * The flat-tint placeholder ground: each block's cell triangles batched into one {@link Mesh}
 * per distinct tile colour (a white texel tinted by the colour), built once. A grass-only
 * block is a single draw call regardless of tile count. Not one `Graphics` of N stroked cells:
 * that tessellates the stroke of every cell and does not batch, so at 65 536 cells it costs
 * ~1 s/frame on any renderer. A shaded map scales each
 * cell's tint CPU-side, quantized to {@link FLAT_SHADE_STEPS} steps — the batches are keyed by
 * exact colour, so an unquantized smooth gradient would explode the per-block mesh count. The
 * flat tint is a placeholder, not the 1:1 look, so the coarse cell-centre shading is fine.
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
          for (let v = 0; v < 3; v++) batch.uvs.push(0, 0); // every vertex samples the 1×1 white texel
          batch.indices.push(base, base + 1, base + 2);
        }
      }
    }
    const children: Mesh[] = [];
    for (const [colour, batch] of byColour) {
      const mesh = new Mesh({ geometry: meshGeometry(batch), texture: Texture.WHITE });
      mesh.tint = colour;
      children.push(mesh);
    }
    return children;
  });
}
