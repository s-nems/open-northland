import { FOG_STATE, type FogView } from '@open-northland/sim';
import { BufferImageSource, Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { FOG_EXPLORED_ALPHA, FOG_UNEXPLORED_ALPHA } from '../../data/fog/index.js';
import { TILE_HALF_H, TILE_HALF_W, type Viewport, visibleTileRange } from '../../data/projection/index.js';

/**
 * The fog-of-war wash over the ground. The sim's VisionSystem decides which cell is unexplored,
 * explored-but-unwatched, or visible and hands the mask over as a {@link FogView}; this layer is a pure
 * projection of it. Only the visible cell band is rasterized, and only when the band moved, the mask
 * rebuilt (`FogView.generation`), the viewer changed seat (`FogView.player`), or the fog mode changed
 * (`FogView.mode` remaps what `stateAt` reports).
 *
 * One texel per cell, stretched over the band and sampled with linear filtering: the GPU's bilinear
 * interpolation spreads each state transition across a whole cell (~68 px), which is what melts the mask
 * into a soft, grid-free gradient.
 *
 * Named approximations, both invisible under a cell-wide gradient: the rectangular texel lattice ignores
 * the odd-row half-cell stagger (fog is offset ≤ half a cell on odd rows), and the wash does not ride the
 * terrain elevation lift (a lifted hill's fog edge sits up to `maxLift` px low). The alphas are tuned by
 * eye.
 */

/** Cells beyond the visible band the wash also covers, so its edge never shows during a pan. */
const FOG_BAND_MARGIN = 3;

/** Texture allocation step (texels) - grow-only, so a steady pan never re-allocates GPU memory. */
const TEXTURE_QUANT = 64;

export class FogLayer {
  readonly container = new Container();
  private readonly sprite = new Sprite();
  private texture: Texture | null = null;
  private buffer: Uint8Array = new Uint8Array(0);
  /** Allocated texture dims in texels; grow-only. */
  private texW = 0;
  private texH = 0;
  /** Signature of the frame last rasterized - an unchanged signature skips the rebuild. */
  private key = '';

  constructor() {
    this.sprite.visible = false;
    this.container.addChild(this.sprite);
  }

  /** Re-rasterize the visible band of `view`'s mask; `null` clears the wash (fog off). */
  update(view: FogView | null, vp: Viewport): void {
    if (view === null) {
      if (this.key !== '') {
        this.sprite.visible = false;
        this.key = '';
      }
      return;
    }
    const band = visibleTileRange(vp, view.cellsWide, view.cellsHigh, FOG_BAND_MARGIN);
    const key = `${band.minCol},${band.maxCol},${band.minRow},${band.maxRow}:${view.player}:${view.generation}:${view.mode}`;
    if (key === this.key) return;

    const bandW = band.maxCol - band.minCol + 1;
    const bandH = band.maxRow - band.minRow + 1;
    this.ensureTexture(bandW, bandH);
    const texture = this.texture;
    if (texture === null) return; // ensureTexture always sets it

    // The texture may be quantized larger than the band; the sprite below crops to the band via the
    // texture frame, so slack texels never show.
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
    // Crop the sampled region to the band (the frame), then stretch it over the band's world box: texel
    // (i, j) centres on cell (minCol+i, minRow+j), whose centre sits at (2c·HALF_W, r·HALF_H), so the box
    // starts half a texel before the first centre and spans one full cell pitch per texel.
    // The frame mutation needs `texture.update()`, not a bare `updateUvs()`: only the former notifies
    // the sprite, which would otherwise draw the previous band's slice once a zoom resizes the band.
    texture.frame.width = bandW;
    texture.frame.height = bandH;
    texture.update();
    this.sprite.texture = texture;
    this.sprite.position.set(
      2 * TILE_HALF_W * band.minCol - TILE_HALF_W,
      TILE_HALF_H * band.minRow - TILE_HALF_H / 2,
    );
    this.sprite.width = bandW * 2 * TILE_HALF_W;
    this.sprite.height = bandH * TILE_HALF_H;
    this.sprite.visible = true;
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
    // Both options are load-bearing: an explicit `frame` keeps `noFrame` false, so `texture.update()`
    // cannot clobber the band crop back to the full source; `dynamic: true` subscribes the Sprite to the
    // texture's `update` event, the only signal it re-reads UVs on.
    this.texture = new Texture({
      source: new BufferImageSource({
        resource: this.buffer,
        width: this.texW,
        height: this.texH,
        scaleMode: 'linear',
      }),
      frame: new Rectangle(0, 0, this.texW, this.texH),
      dynamic: true,
    });
  }

  destroy(): void {
    this.texture?.destroy(true);
    this.container.destroy({ children: true });
  }
}
