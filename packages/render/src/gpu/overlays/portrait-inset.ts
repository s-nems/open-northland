import { type Application, type Container, Rectangle, Sprite, Texture } from 'pixi.js';
import type { Camera } from '../../data/projection/index.js';
import type { SpritePool } from '../sprite-pool/index.js';
import { renderFramedWorld } from './framed-world-render.js';

/**
 * The details-panel portrait window: a live cutout of the world centred on the selected entity, drawn
 * into the panel's preview box each frame. `rect` is that box in screen px; `kind` picks the framing.
 */
export interface PortraitInsetFrame {
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly entityRef: number;
  readonly kind: 'settler' | 'building';
}

/**
 * The terrain re-cull the inset borrows: the ground is chunk-culled to the main viewport, so a re-aimed
 * cutout around a subject at the screen edge would leave transparent holes. The world renderer supplies
 * both halves, so the inset never needs the projection or pad math.
 */
export interface InsetTerrainCull {
  toInset(camera: Camera, w: number, h: number): void;
  restore(): void;
  /** Opaque ground colour (`0xRRGGBB`) the cutout floors its off-map margin with. */
  readonly backdrop: number;
}

/** A building's drawn bounds fill this fraction of the portrait box; the rest is world margin. */
const PORTRAIT_FILL = 0.72;
/** Zoom-out floor, so a huge building's cutout stays legible. */
const PORTRAIT_MIN_SCALE = 0.2;
/** Zoom-in ceiling, so a tiny building avoids a pixel-mush close-up. */
const PORTRAIT_MAX_SCALE = 2.5;
/**
 * World-space height framed for a settler portrait: a viking body is ~32 world units tall, the rest is
 * head/foot margin and clearance for the raised-arm wait frame. An eye-calibrated approximation.
 */
const SETTLER_VIEW_HEIGHT = 58;
/** Where the feet anchor sits down the settler portrait, as a fraction of its height. */
const SETTLER_FEET_FRACTION = 0.84;

/**
 * Renders the portrait cutout: a second, viewport-framed screen render of the shared `worldLayer`,
 * re-aimed at the selected entity and painted into the panel's preview box. It must run as the frame's
 * last render, after the main stage render, because it overpaints a region the panel just drew.
 *
 * Deliberately not a render-to-texture: on Pixi 8.19 WebGL a `worldLayer`-as-root render into a texture
 * goes blank on any frame another render-to-texture ran, which blinked the preview on every
 * details-panel re-bake. `clear: false` keeps the panel's own backdrop behind a sparse cutout.
 */
export class PortraitInsetLayer {
  private frame: PortraitInsetFrame | null = null;
  /** The ground-coloured off-map floor quad, parented into the world only for the pass. */
  private readonly backdrop = new Sprite(Texture.WHITE);

  constructor(
    private readonly app: Application,
    private readonly worldLayer: Container,
    private readonly pool: SpritePool,
  ) {}

  set(frame: PortraitInsetFrame | null): void {
    this.frame = frame;
  }

  /** The entity the portrait is centred on, so the sprite pool can force-draw it through the cull: the
   *  cutout must survive the subject scrolling off-screen or stepping inside a building. */
  subjectRef(): number | null {
    return this.frame?.entityRef ?? null;
  }

  /**
   * The inset camera framing (world centre + px-per-world scale), or null when the entity wasn't drawn
   * this frame. A building fits its static drawn bounds in the box; a settler frames a fixed window off
   * its stable feet anchor, never the swaying animation bounds, so a standing unit's cutout holds still.
   */
  private framing(
    f: PortraitInsetFrame,
    w: number,
    h: number,
  ): { cx: number; cy: number; scale: number } | null {
    if (f.kind === 'settler') {
      const anchor = this.pool.anchorOf(f.entityRef);
      if (anchor === undefined) return null;
      return {
        cx: anchor.x,
        cy: anchor.y - SETTLER_VIEW_HEIGHT * (SETTLER_FEET_FRACTION - 0.5),
        scale: h / SETTLER_VIEW_HEIGHT,
      };
    }
    const bounds = this.pool.boundsOf(f.entityRef);
    if (bounds === undefined) return null;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const boundsW = Math.max(1, bounds.maxX - bounds.minX);
    const boundsH = Math.max(1, bounds.maxY - bounds.minY);
    const scale = Math.max(
      PORTRAIT_MIN_SCALE,
      Math.min(PORTRAIT_MAX_SCALE, Math.min(w / boundsW, h / boundsH) * PORTRAIT_FILL),
    );
    return { cx, cy, scale };
  }

  /**
   * Paint the portrait window: re-aim `worldLayer` onto the selected entity and render it into the
   * preview box's screen viewport (`frame` is in logical px, which the render target scales by its
   * resolution). `SpritePool.portraitPass` scopes the pool's half of the borrow; the callback restores
   * its own - world transform, solo stash, backdrop quad and terrain cull - even if the render throws.
   * Must run after the pool reconcile and after the main stage render.
   */
  draw(mainCamera: Camera, terrain?: InsetTerrainCull): void {
    const f = this.frame;
    if (f === null || f.rect.w < 1 || f.rect.h < 1) return;
    const w = Math.round(f.rect.w);
    const h = Math.round(f.rect.h);
    const framing = this.framing(f, w, h);
    if (framing === null) return;
    const { cx, cy, scale } = framing;
    const insetCamera: Camera = { offsetX: w / 2 - cx * scale, offsetY: h / 2 - cy * scale, scale };
    const inset = { camera: insetCamera, width: w, height: h };
    const main = { camera: mainCamera, width: this.app.screen.width, height: this.app.screen.height };
    this.pool.portraitPass(inset, main, (soloKeep) => {
      try {
        // Re-cull the ground to the inset frame, so a subject at the screen edge still has terrain around
        // it. Inside the try, so its `restore()` below always pairs.
        terrain?.toInset(insetCamera, w, h);
        renderFramedWorld(this.app, this.worldLayer, this.backdrop, {
          camera: insetCamera,
          frame: new Rectangle(f.rect.x, f.rect.y, w, h),
          // The region framed past the map edge has no terrain, and the screen pass cannot `clear` just its
          // frame region, so floor it with the ground colour. An indoor solo keeps the panel's backdrop.
          fill: terrain !== undefined && soloKeep === null ? terrain.backdrop : null,
          // An indoor subject renders alone: the pool already hid its sprite-layer siblings, and every
          // other world layer blanks too, or the building it stands in reads as its floor.
          keep: soloKeep,
        });
      } finally {
        terrain?.restore();
      }
    });
  }
}
