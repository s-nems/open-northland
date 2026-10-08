import { CanvasSource, Rectangle, Texture } from 'pixi.js';
import { clamp01 } from '../../data/math.js';
import { readable2dContext } from '../drawable-resource.js';
import { noise } from './surface.js';

export const FIRE_FRAMES = 24;
export const FIRE_VARIANTS = 5;
const TILE = 64;

/** Independently authored procedural art, packed into a shared atlas. */
export class DamageEffectTextures {
  readonly smoke: readonly Texture[];
  readonly flames: readonly Texture[];
  private readonly source: CanvasSource | undefined;

  constructor(includeFire = true) {
    const columns = includeFire ? 16 : 4;
    const ctx = readable2dContext(TILE * columns, TILE * (includeFire ? 8 : 1));
    if (ctx === null) {
      this.smoke = [];
      this.flames = [];
      return;
    }
    this.source = new CanvasSource({ resource: ctx.canvas, scaleMode: 'linear' });
    const smoke: Texture[] = [];
    const flames: Texture[] = [];
    for (let tile = 0; tile < (includeFire ? FIRE_FRAMES * FIRE_VARIANTS : 0) + 4; tile++) {
      const x = (tile % columns) * TILE;
      const y = Math.floor(tile / columns) * TILE;
      const image = ctx.createImageData(TILE, TILE);
      if (tile < 4) paintSmoke(image.data, tile);
      else paintFire(image.data, (tile - 4) % FIRE_FRAMES, Math.floor((tile - 4) / FIRE_FRAMES));
      ctx.putImageData(image, x, y);
      const tex = new Texture({ source: this.source, frame: new Rectangle(x, y, TILE, TILE) });
      (tile < 4 ? smoke : flames).push(tex);
    }
    this.smoke = smoke;
    this.flames = flames;
  }

  destroy(): void {
    for (const texture of [...this.smoke, ...this.flames]) texture.destroy();
    this.source?.destroy();
  }
}

function smoothNoise(x: number, y: number, seed: number, period = 0): number {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const u = x - ix,
    v = y - iy;
  const sx = u * u * (3 - 2 * u),
    sy = v * v * (3 - 2 * v);
  const row = period > 0 ? ((iy % period) + period) % period : iy;
  const next = period > 0 ? (row + 1) % period : iy + 1;
  const a = noise(seed, ix + row * 173),
    b = noise(seed, ix + 1 + row * 173);
  const c = noise(seed, ix + next * 173),
    d = noise(seed, ix + 1 + next * 173);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

function paintSmoke(data: Uint8ClampedArray, seed: number): void {
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const dx = (x - 32) / 26,
        dy = (y - 32) / 25;
      const coarse = smoothNoise(x / 10, y / 10, seed + 57);
      const fine = smoothNoise(x / 3, y / 3, seed + 24);
      const density = clamp01((1 - Math.hypot(dx, dy) + (coarse - 0.5) * 0.55) * 2.2);
      const at = (y * TILE + x) * 4;
      const light = 130 + coarse * 58 + fine * 13 - dy * 10;
      data[at] = light;
      data[at + 1] = light - 3;
      data[at + 2] = light - 8;
      data[at + 3] = density * density * (0.67 + fine * 0.23) * 255;
    }
}

function paintFire(data: Uint8ClampedArray, frame: number, variant: number): void {
  const seed = 43 + variant * 179;
  const tongues = [1, 2, 4, 3, 2][variant] ?? 2;
  const spread = [5, 19, 27, 15, 21][variant] ?? 15;
  const reach = [1, 0.75, 0.6, 0.9, 0.85][variant] ?? 1;
  const phase = (frame / FIRE_FRAMES) * Math.PI * 2;
  const centres = new Float32Array(tongues),
    widths = new Float32Array(tongues),
    tips = new Float32Array(tongues);
  const sway = Math.sin(phase) * 0.4;
  for (let y = 3; y < TILE - 3; y++) {
    const up = (59 - y) / 55;
    const wave = Math.sin(up * 9 - phase) * 4 + Math.sin(up * 17 - phase * 2) * 2.8;
    for (let tongue = 0; tongue < tongues; tongue++) {
      centres[tongue] =
        32 +
        (noise(seed, tongue + 1) - 0.5) * spread +
        wave * up * (0.55 + noise(seed, tongue + 2)) +
        Math.sin(phase + tongue * 2 + up * 6) * up * 3;
      const height =
        reach *
        (0.72 + noise(seed, tongue + 3) * 0.15 + 0.17 * Math.sin(phase * (1 + (tongue % 2)) + tongue * 2.1));
      widths[tongue] =
        clamp01(1 - up / height) ** 0.65 *
        (7 + noise(seed, tongue + 4) * 7 + 2 * Math.sin(phase * 2 + tongue));
      tips[tongue] = clamp01((height - up) * 8);
    }
    for (let x = 3; x < TILE - 3; x++) {
      let field = 0;
      for (let tongue = 0; tongue < tongues; tongue++) {
        const width = widths[tongue] ?? 0;
        if (width <= 0) continue;
        field = Math.max(field, (1 - Math.abs(x - (centres[tongue] ?? 32)) / width) * (tips[tongue] ?? 0));
      }
      if (field <= 0) continue;
      const flow = smoothNoise(x / 5 + sway, y / 7 + (frame * 8) / FIRE_FRAMES, seed, 8);
      const wisps = smoothNoise(x / 2.5, y / 4 + (frame * 8) / FIRE_FRAMES, seed + 38, 8);
      const density = field - flow * (0.2 + up * 0.7) - wisps * 0.25;
      if (density <= 0) continue;
      const baseFade = clamp01((60 - y) / 9);
      const heat = clamp01(density * 1.7) ** 0.85 * (1 - up * 0.45);
      const at = (y * TILE + x) * 4;
      data[at] = 218 + heat * 37;
      data[at + 1] = 63 + heat * 165;
      data[at + 2] = 12 + heat ** 4 * 130;
      data[at + 3] = clamp01(density * 2.7) * baseFade * 235;
    }
  }
}
