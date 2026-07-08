import { Graphics, Mesh, MeshGeometry, type Shader, Texture, type TextureSource } from 'pixi.js';
import { scaleColour } from '../../data/brightness.js';
import { TILE_HALF_H, TILE_HALF_W } from '../../data/iso.js';
import { makeShadedTerrainShader } from '../shading.js';

/** A chunk's display child: a per-page mesh (stock or brightness-shaded shader) or the fallback trace. */
export type TerrainChild = Mesh<MeshGeometry, Shader> | Graphics;

/** The batched geometry accumulated for one draw call (a colour, or a texture page) within a chunk. */
export interface TerrainBatch {
  readonly positions: number[];
  readonly uvs: number[];
  readonly indices: number[];
  /**
   * Per-vertex canonical-cell-coordinate UVs into the map's brightness-lane texture (2 per position
   * pair) — pushed by the caller in lockstep with {@link positions} ONLY on a shaded map
   * (`BrightnessField.shaded`); left empty on the unshaded path so its geometry (and draw pipeline)
   * stays byte-identical.
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
 * (`shaded-mesh.ts`) consumes; an empty lane adds nothing (the stock mesh shader).
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
 * The per-texture-page batch accumulator for ONE chunk, shared by the two textured build paths
 * (per-typeId diamonds and per-triangle 1:1 ground): get-or-create a batch per page, trace unbound
 * cells into a shared fallback {@link Graphics}, then emit one {@link Mesh} per page (+ the fallback
 * when any cell used it) — so the draw-call count per block is ~one per touched page (a shaded map
 * swaps the meshes' shader, never their count). SINGLE-USE per
 * chunk build: accumulate first, then call {@link children} exactly once (it hands ownership of the
 * accumulated display objects to the chunk).
 */
export class ChunkBatcher {
  private readonly byPage = new Map<string, TerrainBatch & { source: TextureSource }>();
  private readonly fallback = new Graphics();
  private fallbackUsed = false;

  /** @param brightnessTex the map's `embr` lane as an R8 texture — bound into the shaded ground
   *  shader of every mesh whose batch accumulated `brightnessUVs`; undefined on an unshaded map. */
  constructor(private readonly brightnessTex?: TextureSource) {}

  /** The (created-on-first-use) batch every cell/triangle sampling `pageKey` accumulates into. */
  batchFor(pageKey: string, source: TextureSource): TerrainBatch {
    let batch = this.byPage.get(pageKey);
    if (batch === undefined) {
      batch = { ...emptyBatch(), source };
      this.byPage.set(pageKey, batch);
    }
    return batch;
  }

  /** Trace one flat-colour ground diamond (the unbound-cell fallback). `lifts` (`[top, right, bottom,
   *  left]`, world px) lifts each corner by terrain height, matching the meshed cells around it;
   *  `brightness` (a cell-centre multiplier, default 1) darkens/brightens the flat fill CPU-side — a
   *  solid fill can't gradient, so the cell centre stands in for the whole diamond. */
  drawFallback(sx: number, sy: number, colour: number, lifts?: readonly number[], brightness = 1): void {
    this.fallback
      .moveTo(sx, sy - TILE_HALF_H - (lifts?.[0] ?? 0))
      .lineTo(sx + TILE_HALF_W, sy - (lifts?.[1] ?? 0))
      .lineTo(sx, sy + TILE_HALF_H - (lifts?.[2] ?? 0))
      .lineTo(sx - TILE_HALF_W, sy - (lifts?.[3] ?? 0))
      .closePath()
      .fill({ color: scaleColour(colour, brightness) });
    this.fallbackUsed = true;
  }

  /** The chunk's display children: the fallback (when used) + one mesh per accumulated page. A batch
   *  that accumulated brightness UVs draws through the shaded ground shader instead of the stock mesh
   *  shader — same geometry, same one-draw-call-per-page batching. */
  children(): TerrainChild[] {
    const out: TerrainChild[] = [];
    if (this.fallbackUsed) out.push(this.fallback);
    for (const batch of this.byPage.values()) {
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
