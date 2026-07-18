import { type Application, type Container, Rectangle, type RenderOptions, Sprite, Texture } from 'pixi.js';
import type { Camera } from '../../data/projection/index.js';
import type { SpritePool } from '../sprite-pool/index.js';
import { restoreStash, type StashedVisibility, stashHidden } from '../visibility.js';

/** Pixi's public {@link RenderOptions} omits `frame`, though the runtime honours it (the render-target
 *  system takes it as the viewport region, in the target's logical px) — typed here until it is exposed. */
interface FramedRenderOptions extends RenderOptions {
  readonly frame: Rectangle;
}

/**
 * The details-panel portrait "observation window": a live cutout of the world centred on the selected
 * entity, drawn into the panel's Ogólne/preview box each frame. `rect` is the box in screen px (the
 * panel's on-screen preview area, bevel-inset); `entityRef` is the entity to centre on. `kind` picks the
 * framing: a `building` fits its (static) drawn bounds in the box — a big ship zooms out, a small hut in;
 * a `settler` frames a fixed feet-anchored window, so the cutout tracks only the unit's position and never
 * jitters with the swaying idle "look-around" animation (whose drawn bounds breathe every frame).
 */
export interface PortraitInsetFrame {
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly entityRef: number;
  readonly kind: 'settler' | 'building';
}

/**
 * The terrain re-cull the inset borrows for its render: the ground is chunk-culled to the MAIN viewport,
 * so the chunks around a subject that scrolled to a screen edge are hidden and the re-aimed cutout would
 * leave transparent holes (through which the panel's static fallback bob shows as a duplicate). `toInset`
 * makes the chunks the inset frame covers visible; `restore` puts back the main-view culling. The world
 * renderer supplies both — the inset never needs the projection/pad math.
 */
export interface InsetTerrainCull {
  toInset(camera: Camera, w: number, h: number): void;
  restore(): void;
  /** Opaque ground colour (`0xRRGGBB`) the cutout floors its off-map margin with (a quad under the
   *  world — the screen pass cannot `clear` just its frame region), so the region behind the framed
   *  building blends as ground instead of showing through to the panel's static fallback bob. */
  readonly backdrop: number;
}

/** A building's drawn bounds fill this fraction of the portrait box (the rest is surrounding-world margin). */
const PORTRAIT_FILL = 0.72;
/** Zoom-out floor — a huge building still can't shrink past this (keeps the cutout legible). */
const PORTRAIT_MIN_SCALE = 0.2;
/** Zoom-in ceiling — a tiny building can't blow up past this (avoids a pixel-mush close-up). */
const PORTRAIT_MAX_SCALE = 2.5;
/**
 * World-space height framed for a settler portrait. A viking body is ~32 world units tall; the extra is
 * head/foot margin (and clearance for the raised-arm "look-around" wait frame). A named approximation,
 * eye-calibrated — the settler window is a fixed feet-anchored frame (not a fit to the breathing bounds),
 * so it stays rock-steady while the unit stands and only pans as the unit's feet actually move. Framing
 * more world height pulls the camera back (scale = h / this), so the body sits with a little breathing
 * room in the box rather than filling it edge-to-edge.
 */
const SETTLER_VIEW_HEIGHT = 58;
/** Where the feet anchor sits down the settler portrait (body rises into the upper part, a little ground below). */
const SETTLER_FEET_FRACTION = 0.84;

/**
 * Renders the {@link PortraitInsetFrame} cutout: a second, viewport-framed SCREEN render of the shared
 * {@link Container} `worldLayer` (re-aimed at the selected entity) painted straight into the panel's
 * preview box, run by the {@link import('../world-renderer/index.js').WorldRenderer} right after its
 * main stage render — the box region was just drawn by the panel, and this pass overpaints it as the
 * frame's last render. Deliberately NOT a render-to-texture: a `worldLayer`-as-root render into a
 * texture goes blank on any frame another render-to-texture ran (Pixi 8.19, WebGL; mechanism unpinned
 * — instruction-cache forcing, target reuse and render reordering were all tried), which blinked the
 * preview on every details-panel re-bake — one per construction hammer hit. A screen-target pass has
 * no such failure mode, and `clear: false` keeps the panel's own backdrop behind sparse cutouts (an
 * indoor subject's solo render). No-op when nothing is selected.
 */
export class PortraitInsetLayer {
  private frame: PortraitInsetFrame | null = null;
  /** The ground-coloured off-map floor quad, parented into the world only for the pass. */
  private readonly backdrop = new Sprite(Texture.WHITE);

  /**
   * @param app the shared Pixi app — its renderer draws the re-aimed viewport pass.
   * @param worldLayer the renderer's camera-transformed world container, re-aimed then restored per drawn frame.
   * @param pool the sprite pool, for the selected entity's drawn anchor/bounds + re-placing its team-colour meshes.
   */
  constructor(
    private readonly app: Application,
    private readonly worldLayer: Container,
    private readonly pool: SpritePool,
  ) {}

  /**
   * Set (or clear) the portrait frame — the app passes the box rect + entity ref each frame (null when the
   * selection has no portrait: multi-select, a building-less pick, nothing). The actual second render
   * happens in {@link draw}, right after the main stage render.
   */
  set(frame: PortraitInsetFrame | null): void {
    this.frame = frame;
  }

  /** The entity the portrait is centred on, so the sprite pool can force-draw it through the cull (its
   *  cutout must survive the subject scrolling off-screen or stepping inside a building). Null when no
   *  portrait is set. */
  subjectRef(): number | null {
    return this.frame?.entityRef ?? null;
  }

  /**
   * The inset camera framing (world centre + px-per-world scale) for the portrait's entity, or `null` when
   * it wasn't drawn this frame (off-screen / culled). A building fits its static drawn bounds in the box; a
   * settler frames a fixed window off its stable feet anchor (never the swaying animation bounds), so a
   * standing unit's cutout holds still and only pans when its feet actually move.
   */
  private framing(
    f: PortraitInsetFrame,
    w: number,
    h: number,
  ): { cx: number; cy: number; scale: number } | null {
    if (f.kind === 'settler') {
      const anchor = this.pool.anchorOf(f.entityRef);
      if (anchor === undefined) return null;
      // Scale a nominal body height to the box height, centre on the feet (raised so the body fills the
      // upper part). Position-only: no bounds term, so the idle sway can't move or resize the cutout.
      return {
        cx: anchor.x,
        cy: anchor.y - SETTLER_VIEW_HEIGHT * (SETTLER_FEET_FRACTION - 0.5),
        scale: h / SETTLER_VIEW_HEIGHT,
      };
    }
    const bounds = this.pool.boundsOf(f.entityRef);
    if (bounds === undefined) return null;
    // Centre on the bounds and scale to fit them in the box (a big building zooms out, a small one in).
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
   * Paint the portrait observation window: re-aim {@link worldLayer} onto the selected entity, render it
   * into the preview box's screen viewport (`frame` is in logical px — the render target scales it by its
   * resolution), then restore the main-camera state. The framing ({@link framing}) is building-fit or
   * settler-fixed; if the entity wasn't drawn this frame (off-screen/culled) nothing paints and the panel
   * placeholder shows. `mainCamera` is the frame's main camera, restored after the re-aimed render so the
   * paletted team-colour meshes return to their on-screen placement. `terrain` re-culls the ground to the
   * inset frame for the pass (restored after) and supplies the ground colour the off-map margin is floored
   * with. Must run after the pool reconcile (so it uses this frame's positions) and after the main stage
   * render (this pass paints over the panel, so nothing may draw on top of it).
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
    const savedScale = this.worldLayer.scale.x;
    const savedX = this.worldLayer.position.x;
    const savedY = this.worldLayer.position.y;
    // Plain sprites + terrain ride the worldLayer transform; the screen-space team-colour character meshes
    // must be re-placed for the inset camera (they can't ride it; no flip — this is a screen pass), then
    // restored (main camera) after.
    this.pool.placePalettedFor(insetCamera, w, h, false);
    this.worldLayer.scale.set(scale);
    this.worldLayer.position.set(insetCamera.offsetX, insetCamera.offsetY);
    // Reveal the subject if the pool force-hid it on the main map (off-screen / inside a building), draw
    // the cutout, then hide it again so the next main stage render still omits it.
    this.pool.showPortraitSubject();
    // An indoor subject (frozen, standing in its workplace) renders ALONE over the panel's backdrop: blank
    // every world layer but the one holding the subject, and let the pool hide the subject's sprite-layer
    // siblings — otherwise the building it stands in draws behind it and it reads as standing on the roof.
    const subjectContainer = this.pool.portraitSubjectContainer();
    const soloParent =
      this.pool.portraitSubjectIsIndoor() && subjectContainer !== null ? subjectContainer.parent : null;
    let worldSaved: StashedVisibility[] | null = null;
    if (soloParent !== null) {
      worldSaved = stashHidden(this.worldLayer.children, soloParent);
      this.pool.beginPortraitSolo();
    }
    // Restore the whole inset borrow — visibility toggles, the world transform and the mesh placement —
    // even if the render throws, so a failed cutout can't leave a real unit hidden on the main map, the
    // world locked at the inset camera, or the pool's solo bookkeeping stale for the next frame.
    try {
      // Terrain is chunk-culled to the MAIN viewport; re-cull it to the inset frame so the ground around a
      // subject at the screen edge fills the cutout. Inside the try so its `restore()` below always pairs.
      terrain?.toInset(insetCamera, w, h);
      // The region framed past the map edge has no terrain to draw; floor it with a ground-coloured quad
      // under the world (the screen pass cannot `clear` just its frame region) so it reads as more ground
      // instead of revealing the panel's static fallback bob. Skipped for an indoor solo, which
      // deliberately keeps the panel's backdrop behind the lone subject.
      if (terrain !== undefined && soloParent === null) {
        this.backdrop.tint = terrain.backdrop;
        this.backdrop.position.set(-insetCamera.offsetX / scale, -insetCamera.offsetY / scale);
        this.backdrop.width = w / scale;
        this.backdrop.height = h / scale;
        this.worldLayer.addChildAt(this.backdrop, 0);
      }
      const pass: FramedRenderOptions = {
        container: this.worldLayer,
        clear: false, // the main render already painted this region (the panel's preview backdrop)
        frame: new Rectangle(f.rect.x, f.rect.y, w, h),
      };
      this.app.renderer.render(pass);
    } finally {
      this.backdrop.removeFromParent();
      if (worldSaved !== null) {
        this.pool.endPortraitSolo();
        restoreStash(worldSaved);
      }
      this.pool.hidePortraitSubject();
      this.worldLayer.scale.set(savedScale);
      this.worldLayer.position.set(savedX, savedY);
      this.pool.placePalettedFor(mainCamera, this.app.screen.width, this.app.screen.height, false);
      terrain?.restore();
    }
  }
}
