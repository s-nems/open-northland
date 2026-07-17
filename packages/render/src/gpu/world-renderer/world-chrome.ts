import { type Container, Sprite, Texture, type TextureSource } from 'pixi.js';
import { makeVignetteSprite } from '../post-fx.js';
import type { TextureCache } from '../texture-cache.js';

/**
 * The world renderer's screen-space chrome: the two full-screen quads that sit between the world and the
 * HUD (the pause wash and the post-fx vignette) plus the zoom-driven atlas sampling toggle. None of it is
 * world content — it neither rides the camera transform nor reads the snapshot.
 *
 * Both quads are `app.stage` children whose add order IS their z-order, so this class never adds them
 * itself: {@link attach} is called at the one point in the renderer's constructor where they belong.
 */

/**
 * The paused-game wash: one screen-sized multiply quad over the world, not the HUD. The original's
 * observed pause treatment is a neutral 50% darken; this warmer brown is an intentional visual
 * deviation. It costs one extra draw call while paused, but it sits at the world→HUD boundary, which
 * flushes anyway.
 */
const PAUSE_WASH_TINT = 0xc9a87c;

export class WorldChrome {
  /** The paused-game sepia wash (screen-space, over the world, under the HUD). See {@link setPaused}. */
  private readonly pauseWash = new Sprite(Texture.WHITE);
  /** The post-pass vignette sprite ({@link import('./frame.js').WorldRendererOptions.postFx}); null when
   *  off/unavailable. */
  private readonly vignette: Sprite | null;
  /** Atlas pages currently flipped to linear minification by {@link applyWorldSampling} — exactly the
   *  set to restore to nearest when the camera zooms back in. */
  private readonly linearPages = new Set<TextureSource>();

  /**
   * @param textures the renderer's shared frame→texture cache, whose atlas pages {@link applyWorldSampling} flips.
   * @param postFx whether to build the vignette quad at all.
   */
  constructor(
    private readonly textures: TextureCache,
    postFx: boolean,
  ) {
    this.vignette = postFx ? makeVignetteSprite() : null;
    this.pauseWash.tint = PAUSE_WASH_TINT;
    this.pauseWash.blendMode = 'multiply';
    this.pauseWash.visible = false;
  }

  /**
   * Mount the chrome quads on `stage`, in z-order: the vignette sits directly over the world so the grade
   * colours the map but never the chrome, and the pause wash over that, so pausing browns the map but
   * never the HUD or the tool panel. The caller must invoke this after adding the world layer and before
   * adding the HUD — stage child order is the z-order and there is no sorting here.
   */
  attach(stage: Container): void {
    if (this.vignette !== null) stage.addChild(this.vignette);
    stage.addChild(this.pauseWash);
  }

  /** Show/hide the paused-game wash — the app's loop control drives this alongside the sim pause. */
  setPaused(paused: boolean): void {
    this.pauseWash.visible = paused;
  }

  /** Stretch the visible quads to the canvas — they are screen-sized, so this runs per drawn frame. */
  resize(width: number, height: number): void {
    if (this.pauseWash.visible) {
      this.pauseWash.width = width;
      this.pauseWash.height = height;
    }
    if (this.vignette !== null) {
      this.vignette.width = width;
      this.vignette.height = height;
    }
  }

  /**
   * Match the SPRITE atlases' minification to the zoom: below scale 1 nearest sampling drops texels and
   * the zoomed-out bobs sparkle while panning, so the texture-cache pages (RGB bob + shadow atlases —
   * never the indexed character sheets, which don't pass through the cache) flip to linear; at scale ≥ 1
   * exactly the flipped set restores to nearest, keeping magnified pixel art crisp. The terrain pages
   * are untouched — they load linear at every zoom (the original samples them bilinearly). Walks every
   * cached page each frame while zoomed out ({@link linearPages} skips the write, not the visit) — a
   * handful of atlases, so the scan is free. Known limit: the portrait
   * inset re-renders the world magnified in the same frame, so while zoomed out its cutout samples the
   * flipped pages linear (slightly soft) — accepted; a per-render flip would touch every page twice a
   * frame.
   */
  applyWorldSampling(scale: number): void {
    if (scale < 1) {
      for (const source of this.textures.pageSources()) {
        if (this.linearPages.has(source)) continue;
        if (source.scaleMode !== 'nearest') continue; // a page someone loaded linear stays theirs
        source.scaleMode = 'linear';
        this.linearPages.add(source);
      }
    } else if (this.linearPages.size > 0) {
      for (const source of this.linearPages) source.scaleMode = 'nearest';
      this.linearPages.clear();
    }
  }

  /** Destroy the chrome quads and hand the app-owned atlas pages back at the sampling they were lent at.
   *  A page left linear would be skipped by the next renderer's toggle (it only claims pages it finds
   *  nearest) and stay soft. */
  destroy(): void {
    this.vignette?.destroy(true); // owns its baked gradient texture
    this.pauseWash.destroy(); // the shared Texture.WHITE itself is left alone
    for (const source of this.linearPages) source.scaleMode = 'nearest';
    this.linearPages.clear();
  }
}
