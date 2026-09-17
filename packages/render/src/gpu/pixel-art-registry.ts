import type { Texture, TextureSource } from 'pixi.js';

/** How original pixel art magnifies under enhanced sampling; `bilinear` is the sampler's own filter. */
export type PixelArtScaler = 'bilinear' | 'sharp' | 'xbr';
export const DEFAULT_PIXEL_ART_SCALER: PixelArtScaler = 'xbr';
/** `off` is enhanced sampling disabled: world sprites sample exactly as Pixi's default batcher. */
export type WorldMagnification = PixelArtScaler | 'off';
const MAGNIFY_MODES: Readonly<Record<WorldMagnification, number>> = { off: 0, bilinear: 1, sharp: 2, xbr: 3 };

/**
 * Atlas pages loaded as authored pixel art, and the textures the world's caches mint from them. A
 * marked texture magnifies only inside the `world` batcher, which only `worldBatched` sprites reach;
 * HUD elements drawing the same goods pages through their own textures and Pixi's default batcher
 * stay untouched.
 */
const pixelArtSources = new WeakSet<TextureSource>();
const magnifiedTextures = new WeakSet<Texture>();

export function markPixelArtSource(source: TextureSource): void {
  pixelArtSources.add(source);
}

/** Register a world texture for edge-aware magnification; a no-op unless its page is pixel art. */
export function markMagnifiedTexture(texture: Texture, page: TextureSource = texture.source): void {
  if (pixelArtSources.has(page)) magnifiedTextures.add(texture);
}

export function isMagnifiedTexture(texture: Texture): boolean {
  return magnifiedTextures.has(texture);
}

/** The mode the batch shader is compiled for; one value for every renderer on the page. */
let magnifyMode = MAGNIFY_MODES.off;

export function setPixelArtMagnification(mode: WorldMagnification): void {
  magnifyMode = MAGNIFY_MODES[mode];
}

export function pixelArtMagnifyMode(): number {
  return magnifyMode;
}
