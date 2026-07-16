import { type Application, type Container, RenderTexture, Sprite } from 'pixi.js';
import type { Camera } from '../../data/iso.js';
import type { SpritePool } from '../sprite-pool/index.js';

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
 * Renders the {@link PortraitInsetFrame} cutout: a second render of the shared {@link Container}
 * `worldLayer` (re-aimed at the selected entity), run by the {@link
 * import('./world-renderer.js').WorldRenderer} just before its main stage render. The inset {@link Sprite}
 * is a stage child raised over the (later-mounted, frequently-rebuilt) details panel each frame it shows.
 * Null/hidden when nothing is selected.
 */
export class PortraitInsetLayer {
  private frame: PortraitInsetFrame | null = null;
  private texture: RenderTexture | null = null;
  private readonly sprite = new Sprite();

  /**
   * @param app the shared Pixi app — its renderer draws the re-aimed cutout, and its stage holds the inset sprite.
   * @param worldLayer the renderer's camera-transformed world container, re-aimed then restored per drawn frame.
   * @param pool the sprite pool, for the selected entity's drawn anchor/bounds + re-placing its team-colour meshes.
   */
  constructor(
    private readonly app: Application,
    private readonly worldLayer: Container,
    private readonly pool: SpritePool,
  ) {
    this.sprite.visible = false;
    app.stage.addChild(this.sprite);
  }

  /**
   * Set (or clear) the portrait frame — the app passes the box rect + entity ref each frame (null when the
   * selection has no portrait: multi-select, a building-less pick, nothing). The actual second render
   * happens in {@link draw}, just before the main stage render.
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
   * Render the portrait observation window: re-aim {@link worldLayer} onto the selected entity, render it to
   * the inset texture, then restore the main camera (the main stage render draws with the restored transform).
   * The framing ({@link framing}) is building-fit or settler-fixed; if the entity wasn't drawn this frame
   * (off-screen/culled) the inset hides and the panel placeholder shows. `mainCamera` is the frame's main
   * camera, restored after the re-aimed render so the paletted team-colour meshes return to their on-screen
   * placement. Must run after the pool reconcile (so it uses this frame's positions) and before the main
   * stage render (so the on-stage inset sprite shows this frame's cutout).
   */
  draw(mainCamera: Camera): void {
    const f = this.frame;
    if (f === null || f.rect.w < 1 || f.rect.h < 1) {
      this.sprite.visible = false;
      return;
    }
    const w = Math.round(f.rect.w);
    const h = Math.round(f.rect.h);
    const framing = this.framing(f, w, h);
    if (framing === null) {
      this.sprite.visible = false;
      return;
    }
    if (this.texture === null || this.texture.width !== w || this.texture.height !== h) {
      this.texture?.destroy(true);
      this.texture = RenderTexture.create({
        width: w,
        height: h,
        resolution: this.app.renderer.resolution,
      });
      this.sprite.texture = this.texture;
    }
    const { cx, cy, scale } = framing;
    const insetCamera: Camera = { offsetX: w / 2 - cx * scale, offsetY: h / 2 - cy * scale, scale };
    const savedScale = this.worldLayer.scale.x;
    const savedX = this.worldLayer.position.x;
    const savedY = this.worldLayer.position.y;
    // Plain sprites + terrain ride the worldLayer transform; the screen-space team-colour character meshes
    // must be re-placed for the inset camera (they can't ride it) and flipped upright for the bottom-up
    // render texture, then restored (main camera, no flip) after.
    this.pool.placePalettedFor(insetCamera, w, h, true);
    this.worldLayer.scale.set(scale);
    this.worldLayer.position.set(insetCamera.offsetX, insetCamera.offsetY);
    // Reveal the subject if the pool force-hid it on the main map (off-screen / inside a building), draw
    // the cutout, then hide it again so the main stage render below still omits it.
    this.pool.showPortraitSubject();
    // An indoor subject (frozen, standing in its workplace) renders ALONE on the transparent cutout: blank
    // every world layer but the one holding the subject, and let the pool hide the subject's sprite-layer
    // siblings — otherwise the building it stands in draws behind it and it reads as standing on the roof.
    const subjectContainer = this.pool.portraitSubjectContainer();
    const soloParent =
      this.pool.portraitSubjectIsIndoor() && subjectContainer !== null ? subjectContainer.parent : null;
    let worldSaved: { child: { visible: boolean }; wasVisible: boolean }[] | null = null;
    if (soloParent !== null) {
      worldSaved = this.worldLayer.children.map((child) => ({ child, wasVisible: child.visible }));
      for (const child of this.worldLayer.children) if (child !== soloParent) child.visible = false;
      this.pool.beginPortraitSolo();
    }
    this.app.renderer.render({ container: this.worldLayer, target: this.texture, clear: true });
    if (worldSaved !== null) {
      this.pool.endPortraitSolo();
      for (const { child, wasVisible } of worldSaved) child.visible = wasVisible;
    }
    this.pool.hidePortraitSubject();
    this.worldLayer.scale.set(savedScale);
    this.worldLayer.position.set(savedX, savedY);
    this.pool.placePalettedFor(mainCamera, this.app.screen.width, this.app.screen.height, false);

    this.sprite.position.set(f.rect.x, f.rect.y);
    this.sprite.width = w;
    this.sprite.height = h;
    this.sprite.visible = true;
    // The details panel mounts after this renderer and re-adds its root to the stage top on every rebuild
    // (≈4 Hz), so raise the inset above it every shown frame — otherwise the baked panel covers the cutout.
    this.app.stage.addChild(this.sprite);
  }

  /** Free the inset sprite + its render texture. */
  destroy(): void {
    this.sprite.destroy();
    this.texture?.destroy(true);
  }
}
