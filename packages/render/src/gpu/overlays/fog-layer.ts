import { FOG_STATE, type FogView } from '@open-northland/sim';
import { BufferImageSource, Container, Mesh, MeshGeometry, Texture, type TextureSource } from 'pixi.js';
import {
  FOG_EXPLORED_ALPHA,
  FOG_UNEXPLORED_ALPHA,
  fogWashGeometry,
  fogWashLiftRows,
} from '../../data/fog/index.js';
import { TILE_HALF_H, TILE_HALF_W, type Viewport, visibleTileRange } from '../../data/projection/index.js';
import type { ElevationField } from '../../data/terrain/index.js';

/**
 * The fog-of-war wash over the ground. The sim's VisionSystem decides which cell is unexplored,
 * explored-but-unwatched, or visible and hands the mask over as a {@link FogView}; this layer is a pure
 * projection of it. Only the visible cell band is rasterized, and only when the band moved, the mask
 * rebuilt (`FogView.generation`), the viewer changed seat (`FogView.player`), the fog mode changed
 * (`FogView.mode` remaps what `stateAt` reports), or the terrain under it changed.
 *
 * One texel per cell, drawn by a vertex grid lifted with the terrain (`fogWashGeometry`) and sampled
 * with linear filtering: the GPU's bilinear interpolation spreads each state transition across a whole
 * cell (~68 px), which is what melts the mask into a soft, grid-free gradient. The alphas are tuned by
 * eye.
 */

/** Cells beyond the visible band the wash also covers, so its edge never shows during a pan. */
const FOG_BAND_MARGIN = 3;

/** Texture allocation step (texels) - grow-only, so a steady pan never re-allocates GPU memory. */
const TEXTURE_QUANT = 64;

/** Where the wash's texture lies in the world, for a shader that samples it: one texel per cell. */
export interface FogWashMask {
  /** Null while the fog is off. */
  readonly source: TextureSource | null;
  /** World px of the band's first texel corner. */
  readonly originX: number;
  readonly originY: number;
  /** Texels of the band in use, and of the whole texture. */
  readonly bandW: number;
  readonly bandH: number;
  readonly texW: number;
  readonly texH: number;
}

type MutableFogWashMask = { -readonly [K in keyof FogWashMask]: FogWashMask[K] };

export class FogLayer {
  readonly container = new Container();
  private readonly mesh = new Mesh({ geometry: new MeshGeometry({}) });
  private texture: Texture | null = null;
  private buffer: Uint8Array = new Uint8Array(0);
  /** Allocated texture dims in texels; grow-only. */
  private texW = 0;
  private texH = 0;
  /** Signature of the frame last rasterized - an unchanged signature skips the rebuild. */
  private key = '';
  /** The terrain the wash was last lifted over, and a count of the fields seen, for the signature. */
  private elevation: ElevationField | undefined;
  private elevationVersion = 0;
  private readonly washMask: MutableFogWashMask = {
    source: null,
    originX: 0,
    originY: 0,
    bandW: 0,
    bandH: 0,
    texW: 0,
    texH: 0,
  };

  constructor() {
    this.mesh.visible = false;
    this.container.addChild(this.mesh);
  }

  /** The wash as drawn, rewritten in place on every rebuild. */
  get mask(): FogWashMask {
    return this.washMask;
  }

  /** Re-rasterize the visible band of `view`'s mask over `elevation`'s terrain; `null` clears the wash
   *  (fog off). */
  update(view: FogView | null, vp: Viewport, elevation?: ElevationField): void {
    if (view === null) {
      if (this.key !== '') {
        this.mesh.visible = false;
        this.washMask.source = null;
        this.key = '';
      }
      return;
    }
    if (elevation !== this.elevation) {
      this.elevation = elevation;
      this.elevationVersion++;
    }
    const screen = visibleTileRange(vp, view.cellsWide, view.cellsHigh, FOG_BAND_MARGIN);
    const band = {
      ...screen,
      maxRow: Math.min(screen.maxRow + fogWashLiftRows(elevation), view.cellsHigh - 1),
    };
    const key = `${band.minCol},${band.maxCol},${band.minRow},${band.maxRow}:${view.player}:${view.generation}:${view.mode}:${this.elevationVersion}`;
    if (key === this.key) return;

    const bandW = band.maxCol - band.minCol + 1;
    const bandH = band.maxRow - band.minRow + 1;
    this.ensureTexture(bandW, bandH);
    const texture = this.texture;
    if (texture === null) return; // ensureTexture always sets it

    // The texture may be quantized larger than the band; the mesh samples only the band's texels.
    const buf = this.buffer;
    for (let j = 0; j < bandH; j++) {
      const rowBase = j * this.texW;
      for (let i = 0; i < bandW; i++) {
        const state = view.stateAt(band.minCol + i, band.minRow + j);
        buf[(rowBase + i) * 4 + 3] =
          state === FOG_STATE.VISIBLE
            ? 0
            : state === FOG_STATE.EXPLORED
              ? FOG_EXPLORED_ALPHA
              : FOG_UNEXPLORED_ALPHA;
      }
    }
    texture.source.update();
    const previous = this.mesh.geometry;
    this.mesh.geometry = new MeshGeometry(fogWashGeometry(band, this.texW, this.texH, elevation));
    previous.destroy();
    this.mesh.texture = texture;
    // The flat box a sampling shader maps the band to: texel (i, j) centres on cell (minCol+i, minRow+j)
    // at (2c·HALF_W, r·HALF_H), so the box starts half a texel before the first centre.
    const mask = this.washMask;
    mask.source = texture.source;
    mask.originX = 2 * TILE_HALF_W * band.minCol - TILE_HALF_W;
    mask.originY = TILE_HALF_H * band.minRow - TILE_HALF_H / 2;
    mask.bandW = bandW;
    mask.bandH = bandH;
    mask.texW = this.texW;
    mask.texH = this.texH;
    this.mesh.visible = true;
    // Marked only now: a failed alloc above retries next frame instead of skipping on a stale signature.
    this.key = key;
  }

  /** Grow-only quantized (re)allocation of the CPU buffer + linear-filtered GPU texture. */
  private ensureTexture(w: number, h: number): void {
    const quantW = Math.ceil(w / TEXTURE_QUANT) * TEXTURE_QUANT;
    const quantH = Math.ceil(h / TEXTURE_QUANT) * TEXTURE_QUANT;
    if (this.texture !== null && this.texW >= quantW && this.texH >= quantH) return;
    this.texW = Math.max(quantW, this.texW);
    this.texH = Math.max(quantH, this.texH);
    this.texture?.destroy(true);
    this.buffer = new Uint8Array(this.texW * this.texH * 4); // RGB stay 0 (black); alpha is written per band
    this.texture = new Texture({
      source: new BufferImageSource({
        resource: this.buffer,
        width: this.texW,
        height: this.texH,
        scaleMode: 'linear',
      }),
    });
  }

  destroy(): void {
    this.washMask.source = null;
    this.texture?.destroy(true);
    this.container.destroy({ children: true });
  }
}
