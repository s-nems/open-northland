import { Graphics, Mesh, MeshGeometry, Texture, type TextureSource } from 'pixi.js';
import { TILE_HALF_H, TILE_HALF_W } from '../../data/iso.js';

/** The batched geometry accumulated for one draw call (a colour, or a texture page) within a chunk. */
export interface TerrainBatch {
  readonly positions: number[];
  readonly uvs: number[];
  readonly indices: number[];
}

/** Upload one accumulated terrain batch (positions/uvs/indices) as a {@link MeshGeometry}. */
export function meshGeometry(batch: TerrainBatch): MeshGeometry {
  return new MeshGeometry({
    positions: new Float32Array(batch.positions),
    uvs: new Float32Array(batch.uvs),
    indices: new Uint32Array(batch.indices),
  });
}

/**
 * The per-texture-page batch accumulator for ONE chunk, shared by the two textured build paths
 * (per-typeId diamonds and per-triangle 1:1 ground): get-or-create a batch per page, trace unbound
 * cells into a shared fallback {@link Graphics}, then emit one {@link Mesh} per page (+ the fallback
 * when any cell used it) — so the draw-call count per block is ~one per touched page. SINGLE-USE per
 * chunk build: accumulate first, then call {@link children} exactly once (it hands ownership of the
 * accumulated display objects to the chunk).
 */
export class ChunkBatcher {
  private readonly byPage = new Map<string, TerrainBatch & { source: TextureSource }>();
  private readonly fallback = new Graphics();
  private fallbackUsed = false;

  /** The (created-on-first-use) batch every cell/triangle sampling `pageKey` accumulates into. */
  batchFor(pageKey: string, source: TextureSource): TerrainBatch {
    let batch = this.byPage.get(pageKey);
    if (batch === undefined) {
      batch = { positions: [], uvs: [], indices: [], source };
      this.byPage.set(pageKey, batch);
    }
    return batch;
  }

  /** Trace one flat-colour ground diamond (the unbound-cell fallback). `lifts` (`[top, right, bottom,
   *  left]`, world px) lifts each corner by terrain height, matching the meshed cells around it. */
  drawFallback(sx: number, sy: number, colour: number, lifts?: readonly number[]): void {
    this.fallback
      .moveTo(sx, sy - TILE_HALF_H - (lifts?.[0] ?? 0))
      .lineTo(sx + TILE_HALF_W, sy - (lifts?.[1] ?? 0))
      .lineTo(sx, sy + TILE_HALF_H - (lifts?.[2] ?? 0))
      .lineTo(sx - TILE_HALF_W, sy - (lifts?.[3] ?? 0))
      .closePath()
      .fill({ color: colour });
    this.fallbackUsed = true;
  }

  /** The chunk's display children: the fallback (when used) + one mesh per accumulated page. */
  children(): (Mesh | Graphics)[] {
    const out: (Mesh | Graphics)[] = [];
    if (this.fallbackUsed) out.push(this.fallback);
    for (const batch of this.byPage.values()) {
      out.push(new Mesh({ geometry: meshGeometry(batch), texture: new Texture({ source: batch.source }) }));
    }
    return out;
  }
}
