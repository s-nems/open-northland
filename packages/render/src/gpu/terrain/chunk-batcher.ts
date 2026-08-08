import { Graphics, Mesh, MeshGeometry, type Shader, Texture, type TextureSource } from 'pixi.js';
import { scaleColour } from '../../data/terrain/index.js';
import { makeShadedTerrainShader, type WaveUniforms } from '../shading.js';

export type TerrainChild = Mesh<MeshGeometry, Shader> | Graphics;

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
  return { positions: [], uvs: [], indices: [], brightnessUVs: [], waves: [] };
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
  if (batch.brightnessUVs.length > 0) {
    geometry.addAttribute('aBrightnessUV', { buffer: new Float32Array(batch.brightnessUVs) });
    geometry.addAttribute('aWave', { buffer: new Float32Array(batch.waves) });
  }
  return geometry;
}

/**
 * The per-(layer × texture-page) batch accumulator for one chunk: one {@link Mesh} per touched page
 * per {@link TerrainLayerKind}, with unbound triangles traced into a shared fallback
 * {@link Graphics}. Single-use per chunk build - accumulate first, then call {@link children} once.
 */
export class ChunkBatcher {
  private readonly byLayerPage = new Map<string, TerrainBatch & { source: TextureSource; order: number }>();
  private readonly fallback = new Graphics();
  private fallbackUsed = false;

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

  /** Trace one flat-colour ground triangle for an unbound cell. `positions` is the already-lifted
   *  `[x0,y0, x1,y1, x2,y2]` vertex buffer; `brightness` is the owning cell's centre multiplier,
   *  applied CPU-side to the whole triangle because a solid fill cannot gradient. */
  drawFallbackTriangle(positions: readonly number[], colour: number, brightness = 1): void {
    this.fallback
      .moveTo(positions[0] ?? 0, positions[1] ?? 0)
      .lineTo(positions[2] ?? 0, positions[3] ?? 0)
      .lineTo(positions[4] ?? 0, positions[5] ?? 0)
      .closePath()
      .fill({ color: scaleColour(colour, brightness) });
    this.fallbackUsed = true;
  }

  /** The chunk's display children in paint order: the fallback when used, then one mesh per
   *  accumulated batch, base pages before the overlay layers. */
  children(): TerrainChild[] {
    const out: TerrainChild[] = [];
    if (this.fallbackUsed) out.push(this.fallback);
    const batches = [...this.byLayerPage.values()].sort((a, b) => a.order - b.order);
    for (const batch of batches) {
      const geometry = meshGeometry(batch);
      const texture = new Texture({ source: batch.source });
      if (batch.brightnessUVs.length > 0 && this.brightnessTex !== undefined && this.wave !== undefined) {
        const shader = makeShadedTerrainShader(batch.source, this.brightnessTex, this.wave);
        out.push(new Mesh({ geometry, texture, shader }));
      } else {
        out.push(new Mesh({ geometry, texture }));
      }
    }
    return out;
  }
}
