import { type Application, type Container, Rectangle, Sprite, Texture } from 'pixi.js';
import type { Camera } from '../../data/projection/index.js';
import type { SpritePool } from '../sprite-pool/index.js';
import { renderFramedWorld } from './framed-world-render.js';

/**
 * One portrait window: a live cutout of the world centred on an entity, drawn into a HUD box each frame
 * (the details panel's portrait, the trade window's houses). `rect` is that box in screen px; `kind`
 * picks the framing.
 */
export interface PortraitInsetFrame {
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly entityRef: number;
  readonly kind: 'settler' | 'building' | 'vehicle';
  /** A settler subject's building while it is inside one: kept through the cull for the portrait and
   *  framed whenever the scene draws no figure for the subject (nothing choreographs it in there). */
  readonly inside?: number;
  /** The vehicle a settler subject rides, or the ship a vehicle subject rides: a rider draws no sprite
   *  of its own, so the framing centres on what carries it. */
  readonly aboard?: number;
}

/** The subjects the insets force through the pool's cull this frame. */
export interface PortraitSubjects {
  /** The first settler inset's subject, which may be hidden indoors or soloed. */
  readonly ref: number | null;
  readonly house: number | null;
  /** Every other subject: building insets' houses and a rider's vehicle. */
  readonly others: readonly number[];
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

/** A building's or a vehicle's drawn bounds fill this fraction of the portrait box; the rest is world
 *  margin. */
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

/** A vehicle's held box around its anchor (world px), grown in place. */
interface HeldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Centre a world box in a `w` x `h` portrait at {@link PORTRAIT_FILL}, within the zoom limits. */
function fitFraming(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  w: number,
  h: number,
): { cx: number; cy: number; scale: number } {
  const boundsW = Math.max(1, maxX - minX);
  const boundsH = Math.max(1, maxY - minY);
  const scale = Math.max(
    PORTRAIT_MIN_SCALE,
    Math.min(PORTRAIT_MAX_SCALE, Math.min(w / boundsW, h / boundsH) * PORTRAIT_FILL),
  );
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale };
}

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
  private frames: readonly PortraitInsetFrame[] = [];
  private subjectsNow: PortraitSubjects = { ref: null, house: null, others: [] };
  /** The ground-coloured floor quad, parented into the world only for a pass. */
  private readonly backdrop = new Sprite(Texture.WHITE);
  /** Each framed vehicle's drawn box around its feet anchor over every frame it has drawn, so its cutout
   *  holds one zoom while it turns or its driver walks. */
  private readonly heldVehicleBounds = new Map<number, HeldBounds>();

  constructor(
    private readonly app: Application,
    private readonly worldLayer: Container,
    private readonly pool: SpritePool,
  ) {}

  /** The insets drawn this frame, each painted like the others; an empty list draws none. */
  set(frames: readonly PortraitInsetFrame[]): void {
    this.frames = frames;
    let ref: number | null = null;
    let house: number | null = null;
    const others: number[] = [];
    for (const f of frames) {
      if (f.kind === 'settler' && ref === null) {
        ref = f.entityRef;
        house = f.inside ?? null;
      } else others.push(f.entityRef);
      if (f.aboard !== undefined) others.push(f.aboard);
    }
    this.subjectsNow = { ref, house, others };
    for (const held of this.heldVehicleBounds.keys()) {
      if (!frames.some((f) => f.kind === 'vehicle' && (f.entityRef === held || f.aboard === held)))
        this.heldVehicleBounds.delete(held);
    }
  }

  /** The entities the insets are centred on, so the sprite pool can force-draw them through the cull:
   *  a cutout must survive its subject scrolling off-screen or stepping inside a building. */
  subjects(): PortraitSubjects {
    return this.subjectsNow;
  }

  /**
   * The inset camera framing (world centre + px-per-world scale), or null when nothing it frames was
   * drawn this frame. A building or a vehicle fits its drawn bounds in the box (a carried vehicle its
   * ship's); a settler frames a fixed
   * window off its stable feet anchor (or off the vehicle it rides), never the swaying animation bounds,
   * so a standing unit's cutout holds still.
   */
  private framing(
    f: PortraitInsetFrame,
    w: number,
    h: number,
  ): { cx: number; cy: number; scale: number } | null {
    if (f.kind === 'settler') {
      const anchor = this.pool.anchorOf(f.entityRef) ?? this.aboardAnchor(f);
      if (anchor === undefined) {
        // Hidden inside a building the scene shows nobody in: the cutout frames the building instead.
        return f.inside === undefined ? null : this.boundsFraming(f.inside, w, h);
      }
      return {
        cx: anchor.x,
        cy: anchor.y - SETTLER_VIEW_HEIGHT * (SETTLER_FEET_FRACTION - 0.5),
        scale: h / SETTLER_VIEW_HEIGHT,
      };
    }
    if (f.kind !== 'vehicle') return this.boundsFraming(f.entityRef, w, h);
    const own = this.heldFraming(f.entityRef, w, h);
    return own !== null || f.aboard === undefined ? own : this.heldFraming(f.aboard, w, h);
  }

  /** A vehicle's framing off the union of every box it has drawn around its anchor while framed. */
  private heldFraming(ref: number, w: number, h: number): { cx: number; cy: number; scale: number } | null {
    const bounds = this.pool.boundsOf(ref);
    const anchor = this.pool.anchorOf(ref);
    if (bounds === undefined || anchor === undefined) return null;
    const minX = bounds.minX - anchor.x;
    const minY = bounds.minY - anchor.y;
    const maxX = bounds.maxX - anchor.x;
    const maxY = bounds.maxY - anchor.y;
    let held = this.heldVehicleBounds.get(ref);
    if (held === undefined) {
      held = { minX, minY, maxX, maxY };
      this.heldVehicleBounds.set(ref, held);
    } else {
      held.minX = Math.min(held.minX, minX);
      held.minY = Math.min(held.minY, minY);
      held.maxX = Math.max(held.maxX, maxX);
      held.maxY = Math.max(held.maxY, maxY);
    }
    return fitFraming(
      anchor.x + held.minX,
      anchor.y + held.minY,
      anchor.x + held.maxX,
      anchor.y + held.maxY,
      w,
      h,
    );
  }

  private aboardAnchor(f: PortraitInsetFrame): { x: number; y: number } | undefined {
    return f.aboard === undefined ? undefined : this.pool.anchorOf(f.aboard);
  }

  private boundsFraming(ref: number, w: number, h: number): { cx: number; cy: number; scale: number } | null {
    const bounds = this.pool.boundsOf(ref);
    if (bounds === undefined) return null;
    return fitFraming(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, w, h);
  }

  /**
   * Paint every inset: re-aim `worldLayer` onto each subject and render it into its box's screen
   * viewport (`frame` is in logical px, which the render target scales by its resolution).
   * `SpritePool.portraitPass` scopes the pool's half of the borrow; the callback restores its own -
   * world transform, solo stash, backdrop quad and terrain cull - even if the render throws. Must run
   * after the pool reconcile and after the main stage render.
   */
  draw(mainCamera: Camera, terrain?: InsetTerrainCull): void {
    for (const f of this.frames) this.drawOne(f, mainCamera, terrain);
  }

  private drawOne(f: PortraitInsetFrame, mainCamera: Camera, terrain?: InsetTerrainCull): void {
    if (f.rect.w < 1 || f.rect.h < 1) return;
    const w = Math.round(f.rect.w);
    const h = Math.round(f.rect.h);
    const frame = new Rectangle(f.rect.x, f.rect.y, w, h);
    const framing = this.framing(f, w, h);
    if (framing === null) {
      // Nothing to frame (a subject not drawn this frame): the box still gets its floor, or the map the
      // main render drew under the HUD box would show through and scroll with the camera.
      if (terrain !== undefined) this.fillOnly(frame, terrain.backdrop);
      return;
    }
    const { cx, cy, scale } = framing;
    const insetCamera: Camera = { offsetX: w / 2 - cx * scale, offsetY: h / 2 - cy * scale, scale };
    const inset = { camera: insetCamera, width: w, height: h };
    const main = { camera: mainCamera, width: this.app.screen.width, height: this.app.screen.height };
    const subjects = [
      f.entityRef,
      ...(f.inside === undefined ? [] : [f.inside]),
      ...(f.aboard === undefined ? [] : [f.aboard]),
    ];
    this.pool.portraitPass(subjects, inset, main, (soloKeep) => {
      try {
        // Re-cull the ground to the inset frame, so a subject at the screen edge still has terrain around
        // it. Inside the try, so its `restore()` below always pairs.
        terrain?.toInset(insetCamera, w, h);
        renderFramedWorld(this.app, this.worldLayer, this.backdrop, {
          camera: insetCamera,
          frame,
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

  /** The floor alone: a render that keeps only the floor quad, parked where no world layer draws. */
  private fillOnly(frame: Rectangle, fill: number): void {
    renderFramedWorld(this.app, this.worldLayer, this.backdrop, {
      camera: { offsetX: 0, offsetY: 0, scale: 1 },
      frame,
      fill,
      keep: this.backdrop,
    });
  }
}
