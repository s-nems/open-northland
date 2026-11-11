import { BufferImageSource, Texture } from 'pixi.js';

/** The baked radial glow's size and falloff stops (radius share, alpha). */
export const GLOW_TEXTURE_SIZE = 128;
const GLOW_STOPS: readonly (readonly [number, number])[] = [
  [0, 1],
  [0.4, 0.75],
  [0.75, 0.25],
  [1, 0],
];
const CHANNEL_MAX = 255;

/** A soft radial glow, white and premultiplied, its alpha falling through {@link GLOW_STOPS}: the night's
 *  light pools and a temple's blessing draw with it. */
export function bakeGlow(): Texture {
  const data = new Uint8Array(GLOW_TEXTURE_SIZE * GLOW_TEXTURE_SIZE * 4);
  const centre = GLOW_TEXTURE_SIZE / 2;
  for (let y = 0; y < GLOW_TEXTURE_SIZE; y++) {
    for (let x = 0; x < GLOW_TEXTURE_SIZE; x++) {
      const at = Math.hypot(x + 0.5 - centre, y + 0.5 - centre) / centre;
      const value = Math.round(glowAlpha(at) * CHANNEL_MAX);
      data.fill(value, (y * GLOW_TEXTURE_SIZE + x) * 4, (y * GLOW_TEXTURE_SIZE + x + 1) * 4);
    }
  }
  const source = new BufferImageSource({
    resource: data,
    width: GLOW_TEXTURE_SIZE,
    height: GLOW_TEXTURE_SIZE,
    alphaMode: 'premultiplied-alpha',
    scaleMode: 'linear',
  });
  return new Texture({ source });
}

/** {@link GLOW_STOPS} at radius share `at`, linear between stops and 0 past the last. */
function glowAlpha(at: number): number {
  for (let i = 1; i < GLOW_STOPS.length; i++) {
    const [from, fromAlpha] = GLOW_STOPS[i - 1] ?? [0, 0];
    const [to, toAlpha] = GLOW_STOPS[i] ?? [1, 0];
    if (at <= to) return fromAlpha + ((toAlpha - fromAlpha) * (at - from)) / (to - from);
  }
  return 0;
}
