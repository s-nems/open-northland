import type { Texture, TextureSource } from 'pixi.js';

/** How original pixel art magnifies under enhanced sampling; `bilinear` is the sampler's own filter. */
export type PixelArtScaler = 'bilinear' | 'sharp' | 'xbr';
export const DEFAULT_PIXEL_ART_SCALER: PixelArtScaler = 'xbr';
const SCALER_MODES: Readonly<Record<PixelArtScaler, number>> = { bilinear: 0, sharp: 1, xbr: 2 };

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

/** The mode as the batch shader reads it; one value for every renderer on the page. */
let magnifyMode = SCALER_MODES.bilinear;

export function setPixelArtMagnification(scaler: PixelArtScaler): void {
  magnifyMode = SCALER_MODES[scaler];
}

export function pixelArtMagnifyMode(): number {
  return magnifyMode;
}
