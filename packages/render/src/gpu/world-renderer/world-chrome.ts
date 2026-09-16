import { type Container, Sprite, Texture, type TextureSource } from 'pixi.js';
import { makeVignetteSprite } from '../post-fx.js';
import type { TextureCache } from '../texture-cache.js';

/** The chrome is screen-space, not world content: it neither rides the camera transform nor reads the
 *  snapshot. */

/**
 * The paused-game multiply wash. The original's observed pause treatment is a neutral 50% darken; this
 * warmer brown is a deliberate deviation.
 */
const PAUSE_WASH_TINT = 0xc9a87c;

export class WorldChrome {
  private readonly pauseWash = new Sprite(Texture.WHITE);
  private readonly vignette: Sprite | null;
  /** Atlas pages currently flipped to linear minification. */
  private readonly linearPages = new Set<TextureSource>();

  constructor(
    private readonly textures: TextureCache,
    postFx: boolean,
    private readonly spriteSmoothing = true,
  ) {
    this.vignette = postFx ? makeVignetteSprite() : null;
    this.pauseWash.tint = PAUSE_WASH_TINT;
    this.pauseWash.blendMode = 'multiply';
    this.pauseWash.visible = false;
  }

  /**
   * Mount the chrome quads on `stage`. Stage child order is the z-order and nothing sorts here, so the
   * caller must invoke this after adding the world layer and before adding the HUD.
   */
  attach(stage: Container): void {
    if (this.vignette !== null) stage.addChild(this.vignette);
    stage.addChild(this.pauseWash);
  }

  setPaused(paused: boolean): void {
    this.pauseWash.visible = paused;
  }

  /** The quads are screen-sized, so this runs per drawn frame. */
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
   * Match the sprite atlases' minification to the zoom: below scale 1 nearest sampling drops texels and
   * the zoomed-out bobs sparkle while panning, so the texture-cache pages flip to linear; at scale ≥ 1
   * exactly the flipped set restores to nearest, keeping magnified pixel art crisp.
   *
   * Known limit: the portrait inset re-renders the world magnified in the same frame, so while zoomed out
   * its cutout samples the flipped pages linear and slightly soft. A per-render flip would touch every
   * page twice a frame.
   */
  applyWorldSampling(scale: number, enhanced = false): void {
    if (enhanced || (this.spriteSmoothing && scale < 1)) {
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
