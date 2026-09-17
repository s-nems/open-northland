import type { Texture, TextureSource } from 'pixi.js';

/** How registered pixel-art pages magnify under enhanced sampling; `bilinear` is the sampler's own filter. */
export type PixelArtScaler = 'bilinear' | 'sharp' | 'xbr';
const SCALER_MODES: Readonly<Record<PixelArtScaler, number>> = { bilinear: 0, sharp: 1, xbr: 2 };

/** Atlas pages whose frames are authored pixel art. A page alone does not magnify: goods pages also
 *  draw HUD icons, so the world's texture cache marks the textures it mints from a marked page. */
const pixelArtSources = new WeakSet<TextureSource>();
const magnifiedTextures = new WeakSet<Texture>();

export function markPixelArtSource(source: TextureSource): void {
  pixelArtSources.add(source);
}

export function isPixelArtSource(source: TextureSource): boolean {
  return pixelArtSources.has(source);
}

/** Register a world texture for edge-aware magnification; a no-op unless its page is pixel art. */
export function markMagnifiedTexture(texture: Texture, page: TextureSource = texture.source): void {
  if (pixelArtSources.has(page)) magnifiedTextures.add(texture);
}

export function isMagnifiedTexture(texture: Texture): boolean {
  return magnifiedTextures.has(texture);
}

/** The current magnification mode as the shader reads it; 0 is the sampler's own filter. */
let magnifyMode = 0;
const modeListeners = new Set<(mode: number) => void>();

export function setPixelArtMagnification(scaler: PixelArtScaler): void {
  magnifyMode = SCALER_MODES[scaler];
  for (const listener of modeListeners) listener(magnifyMode);
}

export function pixelArtMagnifyMode(): number {
  return magnifyMode;
}

/** The batch shader subscribes so a live setting change reaches its uniform. */
export function onPixelArtMagnifyMode(listener: (mode: number) => void): void {
  modeListeners.add(listener);
}
