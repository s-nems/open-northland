import { FOG_STATE, type FogView } from '@open-northland/sim';
import { BufferImageSource, Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { FOG_EXPLORED_ALPHA, FOG_UNEXPLORED_ALPHA } from '../../data/fog.js';
import { TILE_HALF_H, TILE_HALF_W } from '../../data/iso.js';
import { type Viewport, visibleTileRange } from '../../data/viewport.js';

/**
 * The fog-of-war wash — the viewer player's visibility mask drawn over the ground: opaque black over
 * unexplored cells (nothing shows), a translucent dark wash over explored-but-unwatched cells (the
 * "terrain only" grey — entities there are separately fog-culled by the sprite pool / map-object
 * layer), and nothing over currently-visible cells. Which cell is which is decided upstream by the
 * sim's VisionSystem and handed here as a {@link FogView}; this layer is a pure projection.
 *
 * Implementation: one texture at one texel per cell (black texels, alpha by state), stretched
 * over the visible cell band and sampled with linear filtering — the GPU's bilinear interpolation
 * spreads each state transition across a whole cell (~68 px), which is what melts the mask into the
 * soft, grid-free fog gradient every classic RTS shows. (A first cut composited per-cell diamonds at
 * reduced resolution, the build-overlay recipe — its half-cell zig-zag steps stayed readably hard at
 * any composite scale, because the softness of that recipe is only ever one composite texel wide.)
 *
 * Two named approximations, both invisible under a cell-wide gradient: the rectangular texel lattice
 * ignores the odd-row half-cell stagger (fog is offset ≤ half a cell on odd rows), and the wash does
 * not ride the terrain elevation lift (a lifted hill's fog edge sits up to `maxLift` px low). The
 * minimap's fog mask shares the first one.
 *
 * Screen-bounded + retained (golden rule 6): only the visible cell band is rasterized, and only when
 * the band moved or the fog masks actually rebuilt (`FogView.generation` — the VisionSystem cadence,
 * a few times a second); a still camera over a still fog re-uploads nothing. Drawn in world space
 * above the terrain + flat decor and below the sprite layer: a fog-culled entity never draws at all,
 * so nothing legitimate can sit on fogged ground above the wash. The alphas are tuned by eye (the
 * grey layer is our modern addition — source basis "observed original behavior"; a human signs off).
 */

/** Cells beyond the visible band the wash also covers, so its edge never shows during a pan. */
const FOG_BAND_MARGIN = 3;

/** Texture allocation step (texels) — grow-only, so a steady pan never re-allocates GPU memory. */
const TEXTURE_QUANT = 64;

export class FogLayer {
  readonly container = new Container();
  private readonly sprite = new Sprite();
  private texture: Texture | null = null;
  private buffer: Uint8Array = new Uint8Array(0);
  /** Allocated texture dims (texels) — grow-only via {@link ensureTexture}. */
  private texW = 0;
  private texH = 0;
  /** Signature of the frame last rasterized; skips the rebuild when nothing changed frame-to-frame. */
  private key = '';

  constructor() {
    this.sprite.visible = false;
    this.container.addChild(this.sprite);
  }

  /**
   * Re-rasterize the wash for one frame: the visible cell band of `view`'s mask; `null` clears it
   * (fog off). Skipped entirely while the band and the fog generation are unchanged.
   */
  update(view: FogView | null, vp: Viewport): void {
    if (view === null) {
      if (this.key !== '') {
        this.sprite.visible = false;
        this.key = '';
      }
      return;
    }
    const band = visibleTileRange(vp, view.cellsWide, view.cellsHigh, FOG_BAND_MARGIN);
    const key = `${band.minCol},${band.maxCol},${band.minRow},${band.maxRow}:${view.generation}:${view.mode}`;
    if (key === this.key) return;

    const bandW = band.maxCol - band.minCol + 1;
    const bandH = band.maxRow - band.minRow + 1;
    this.ensureTexture(bandW, bandH);
    const texture = this.texture;
    if (texture === null) return; // ensureTexture always sets it

    // One texel per band cell: black RGB, alpha by state. The texture may be quantized larger than
    // the band — the sprite below crops to the band via the texture frame, so slack texels never show.
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
    // Crop the sampled region to the band (the frame), then stretch it over the band's world box:
    // texel (i, j) centres on cell (minCol+i, minRow+j) — cell centres sit at (2c·HALF_W, r·HALF_H)
    // (even rows; the odd-row stagger is the named approximation above), so the box starts half a
    // texel before the first centre and spans one full cell pitch per texel. `texture.update()` (not
    // a bare `updateUvs()`) is required after the frame mutation: it emits the texture's `update`
    // event, which is the only signal a bound `dynamic` Sprite re-reads UVs on — without it the
    // sprite keeps the previous band's UVs and the wash draws a wrong-sized mask slice the moment a
    // zoom changes the band dimensions (the fog-detaches-from-terrain corruption).
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
    // Mark rasterized only now — an exception above (a failed alloc) retries next frame instead of
    // skipping on a stale signature.
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
    // The one-texel-per-cell linear filter (see the class doc) needs two texture options set here: an
    // explicit `frame` (so `noFrame` stays false and `texture.update()` cannot clobber the band crop
    // back to the full source) and `dynamic: true` (so the Sprite subscribes to `update` and re-reads
    // UVs when the band resizes) — see the frame-mutation comment in {@link update}.
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
