import { Mesh, MeshGeometry, type Shader, Texture, type TextureSource } from 'pixi.js';
import { scaleColour } from '../../data/terrain/index.js';
import { makeShadedTerrainShader, makeTintedTerrainShader, type WaveUniforms } from '../shading.js';

export type TerrainChild = Mesh<MeshGeometry, Shader>;

import { registerTerrainNodes } from './vertex-colors.js';

/**
 * A terrain draw layer, in paint order: `base` is the opaque ground triangle, `overlay2` the
 * under-transition (`emt3`/`emt4`), `overlay1` the top transition (`emt1`/`emt2`). The overlay pages
 * carry their own alpha mask, so compositing is back-to-front child order with no custom blending.
 */
export type TerrainLayerKind = 'base' | 'overlay2' | 'overlay1';

const LAYER_ORDER: Readonly<Record<TerrainLayerKind, number>> = { base: 0, overlay2: 1, overlay1: 2 };

/** The batched geometry accumulated for one draw call (a colour, or a texture page × layer) within a chunk. */
export interface TerrainBatch {
  readonly positions: number[];
  readonly nodes: number[];
  readonly uvs: number[];
  readonly indices: number[];
  /** Per-vertex UVs into the map's brightness-lane texture, 2 per position pair, pushed in lockstep with
   *  {@link positions} only on a shaded map. */
  readonly brightnessUVs: number[];
  /**
   * Per-vertex water-wave amplitude, 1 per position pair. The shaded ground program declares both
   * attributes, so a land map pushes zeros; empty exactly when {@link brightnessUVs} is.
   */
  readonly waves: number[];
}

export function emptyBatch(): TerrainBatch {
  return { nodes: [], positions: [], uvs: [], indices: [], brightnessUVs: [], waves: [] };
}

/**
 * A batch carrying brightness-lane UVs gains the `aBrightnessUV` attribute the shaded ground shader
 * consumes; an empty lane adds nothing and draws through the stock mesh shader.
 */
export function meshGeometry(batch: TerrainBatch): MeshGeometry {
  const geometry = new MeshGeometry({
    positions: new Float32Array(batch.positions),
    uvs: new Float32Array(batch.uvs),
    indices: new Uint32Array(batch.indices),
  });
  geometry.addAttribute('aVertexColor', {
    buffer: new Float32Array((batch.positions.length / 2) * 3).fill(1),
  });
  // Each emitted triangle owns its three vertices, including repeated corners at seams.
  const bounds = new Float32Array((batch.uvs.length / 2) * 4);
  for (let i = 0; i < batch.uvs.length; i += 6) {
    const us = [batch.uvs[i] ?? 0, batch.uvs[i + 2] ?? 0, batch.uvs[i + 4] ?? 0];
    const vs = [batch.uvs[i + 1] ?? 0, batch.uvs[i + 3] ?? 0, batch.uvs[i + 5] ?? 0];
    const rect = [Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)];
    for (let v = 0; v < 3; v++) bounds.set(rect, (i / 2 + v) * 4);
  }
  geometry.addAttribute('aSampleBounds', { buffer: bounds, format: 'float32x4' });
  registerTerrainNodes(geometry, batch.nodes);
  if (batch.brightnessUVs.length > 0) {
    geometry.addAttribute('aBrightnessUV', { buffer: new Float32Array(batch.brightnessUVs) });
    geometry.addAttribute('aWave', { buffer: new Float32Array(batch.waves) });
  }
  return geometry;
}

/** Shading levels per unit for flat-colour triangles. They batch by exact tint, so an unquantized
 *  gradient would give every cell its own mesh; coarse banding is acceptable on a placeholder path. */
export const FLAT_SHADE_STEPS = 8;

export function quantizeShade(brightness: number): number {
  return Math.round(brightness * FLAT_SHADE_STEPS) / FLAT_SHADE_STEPS;
}

/**
 * The per-(layer × texture-page) batch accumulator for one chunk: one {@link Mesh} per touched page
 * per {@link TerrainLayerKind}, with unbound triangles batched by their flat tint. Single-use per
 * chunk build - accumulate first, then call {@link children} once.
 */
export class ChunkBatcher {
  private readonly byLayerPage = new Map<
    string,
    TerrainBatch & { source: TextureSource; order: number; tint?: number }
  >();

  constructor(
    private readonly brightnessTex?: TextureSource,
    private readonly wave?: WaveUniforms,
  ) {}

  batchFor(pageKey: string, source: TextureSource, layer: TerrainLayerKind = 'base'): TerrainBatch {
    const key = `${layer}:${pageKey}`;
    let batch = this.byLayerPage.get(key);
    if (batch === undefined) {
      batch = { ...emptyBatch(), source, order: LAYER_ORDER[layer] };
      this.byLayerPage.set(key, batch);
    }
    return batch;
  }

  /** Batch one flat-colour ground triangle for an unbound cell. `positions` is the already-lifted
   *  `[x0,y0, x1,y1, x2,y2]` vertex buffer; `brightness` is the owning cell's centre multiplier,
   *  quantized to {@link FLAT_SHADE_STEPS} and applied to the whole triangle as the batch's tint. */
  drawFallbackTriangle(
    positions: readonly number[],
    nodes: readonly (readonly [number, number])[],
    colour: number,
    brightness = 1,
  ): void {
    const tint = scaleColour(colour, quantizeShade(brightness));
    const key = `fallback:${tint}`;
    let batch = this.byLayerPage.get(key);
    if (batch === undefined) {
      batch = { ...emptyBatch(), source: Texture.WHITE.source, order: -1, tint };
      this.byLayerPage.set(key, batch);
    }
    const base = batch.positions.length / 2;
    batch.positions.push(...positions);
    for (const [hx, hy] of nodes) {
      batch.nodes.push(hx, hy);
      batch.uvs.push(0, 0);
    }
    batch.indices.push(base, base + 1, base + 2);
  }

  /** The chunk's display children in paint order: one mesh per accumulated batch, the flat tints
   *  first, then base pages before the overlay layers. */
  children(): TerrainChild[] {
    const out: TerrainChild[] = [];
    const batches = [...this.byLayerPage.values()].sort((a, b) => a.order - b.order);
    for (const batch of batches) {
      const geometry = meshGeometry(batch);
      const texture = new Texture({ source: batch.source });
      if (batch.brightnessUVs.length > 0 && this.brightnessTex !== undefined && this.wave !== undefined) {
        const shader = makeShadedTerrainShader(batch.source, this.brightnessTex, this.wave);
        out.push(new Mesh({ geometry, texture, shader }));
      } else {
        const mesh = new Mesh({
          geometry,
          texture,
          shader: makeTintedTerrainShader(batch.source, this.wave),
        });
        mesh.tint = batch.tint ?? 0xffffff;
        out.push(mesh);
      }
    }
    return out;
  }
}
