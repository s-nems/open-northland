import { Graphics, Mesh, MeshGeometry, type Shader, Texture, type TextureSource } from 'pixi.js';
import { scaleColour } from '../../data/brightness.js';
import { makeShadedTerrainShader } from '../shading.js';

/** A chunk's display child: a per-page mesh (stock or brightness-shaded shader) or the fallback trace. */
export type TerrainChild = Mesh<MeshGeometry, Shader> | Graphics;

/**
 * A terrain draw layer, in paint order: `base` is the opaque ground triangle, `overlay2` the
 * under-transition (`emt3`/`emt4`), `overlay1` the top transition (`emt1`/`emt2`) — the overlays
 * alpha-blend over whatever is below (their RGBA pages carry the mask), so compositing is plain
 * back-to-front child order, no custom blending.
 */
export type TerrainLayerKind = 'base' | 'overlay2' | 'overlay1';

/** Paint order of {@link TerrainLayerKind}s within one chunk (lower draws first). */
const LAYER_ORDER: Readonly<Record<TerrainLayerKind, number>> = { base: 0, overlay2: 1, overlay1: 2 };

/** The batched geometry accumulated for one draw call (a colour, or a texture page × layer) within a chunk. */
export interface TerrainBatch {
  readonly positions: number[];
  readonly uvs: number[];
  readonly indices: number[];
  /**
   * Per-vertex UVs into the map's brightness-lane texture (2 per position pair) — pushed by the
   * caller in lockstep with {@link positions} ONLY on a shaded map (`BrightnessField.shaded`);
   * left empty on the unshaded path so its geometry (and draw pipeline) stays byte-identical.
   */
  readonly brightnessUVs: number[];
}

/** Make an empty {@link TerrainBatch} (also the flat-tint path's accumulator shape). */
export function emptyBatch(): TerrainBatch {
  return { positions: [], uvs: [], indices: [], brightnessUVs: [] };
}

/**
 * Upload one accumulated terrain batch (positions/uvs/indices) as a {@link MeshGeometry}. A batch
 * carrying brightness-lane UVs gains the `aBrightnessUV` attribute the shaded ground shader
 * (`shading.ts`) consumes; an empty lane adds nothing (the stock mesh shader).
 */
export function meshGeometry(batch: TerrainBatch): MeshGeometry {
  const geometry = new MeshGeometry({
    positions: new Float32Array(batch.positions),
    uvs: new Float32Array(batch.uvs),
    indices: new Uint32Array(batch.indices),
  });
  if (batch.brightnessUVs.length > 0) {
    geometry.addAttribute('aBrightnessUV', { buffer: new Float32Array(batch.brightnessUVs) });
  }
  return geometry;
}

/**
 * The per-(layer × texture-page) batch accumulator for ONE chunk, shared by the two textured build
 * paths (1:1 ground and per-typeId): get-or-create a batch per page per {@link TerrainLayerKind},
 * trace unbound triangles into a shared fallback {@link Graphics}, then emit one {@link Mesh} per
 * batch in layer paint order (fallback first, then base pages, then the two overlay layers) — so
 * the draw-call count per block is ~one per touched page per layer, and the translucent transition
 * overlays composite over the opaque ground by child order alone. SINGLE-USE per chunk build:
 * accumulate first, then call {@link children} exactly once.
 */
export class ChunkBatcher {
  private readonly byLayerPage = new Map<string, TerrainBatch & { source: TextureSource; order: number }>();
  private readonly fallback = new Graphics();
  private fallbackUsed = false;

  /** @param brightnessTex the map's `embr` lane as an R8 texture — bound into the shaded ground
   *  shader of every mesh whose batch accumulated `brightnessUVs`; undefined on an unshaded map. */
  constructor(private readonly brightnessTex?: TextureSource) {}

  /** The (created-on-first-use) batch for triangles sampling `pageKey` on the given draw layer. */
  batchFor(pageKey: string, source: TextureSource, layer: TerrainLayerKind = 'base'): TerrainBatch {
    const key = `${layer}:${pageKey}`;
    let batch = this.byLayerPage.get(key);
    if (batch === undefined) {
      batch = { ...emptyBatch(), source, order: LAYER_ORDER[layer] };
      this.byLayerPage.set(key, batch);
    }
    return batch;
  }

  /** Trace one flat-colour ground triangle (the unbound-cell fallback): `positions` is the
   *  `[x0,y0, x1,y1, x2,y2]` vertex buffer (already lifted); `brightness` (a cell-centre multiplier,
   *  default 1) darkens/brightens the flat fill CPU-side — a solid fill can't gradient, so the
   *  apex cell's value stands in for the whole triangle. */
  drawFallbackTriangle(positions: readonly number[], colour: number, brightness = 1): void {
    this.fallback
      .moveTo(positions[0] ?? 0, positions[1] ?? 0)
      .lineTo(positions[2] ?? 0, positions[3] ?? 0)
      .lineTo(positions[4] ?? 0, positions[5] ?? 0)
      .closePath()
      .fill({ color: scaleColour(colour, brightness) });
    this.fallbackUsed = true;
  }

  /** The chunk's display children in paint order: the fallback (when used), then one mesh per
   *  accumulated batch — base pages first, then the overlay layers. A batch that accumulated
   *  brightness UVs draws through the shaded ground shader instead of the stock mesh shader —
   *  same geometry, same one-draw-call-per-batch batching. */
  children(): TerrainChild[] {
    const out: TerrainChild[] = [];
    if (this.fallbackUsed) out.push(this.fallback);
    const batches = [...this.byLayerPage.values()].sort((a, b) => a.order - b.order);
    for (const batch of batches) {
      const geometry = meshGeometry(batch);
      const texture = new Texture({ source: batch.source });
      out.push(
        batch.brightnessUVs.length > 0 && this.brightnessTex !== undefined
          ? new Mesh({
              geometry,
              texture,
              shader: makeShadedTerrainShader(batch.source, this.brightnessTex),
            })
          : new Mesh({ geometry, texture }),
      );
    }
    return out;
  }
}
