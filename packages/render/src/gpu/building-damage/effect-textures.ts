import { CanvasSource, Rectangle, Texture } from 'pixi.js';
import { clamp01 } from '../../data/math.js';
import { readable2dContext } from '../drawable-resource.js';
import { noise } from './surface.js';

export const FIRE_FRAMES = 24;
const TILE = 64;

/** Independently authored procedural art, packed into a shared atlas. */
export class DamageEffectTextures {
  readonly smoke: readonly Texture[];
  readonly flames: readonly Texture[];
  private readonly source: CanvasSource | undefined;

  constructor() {
    const ctx = readable2dContext(TILE * 8, TILE * 4);
    if (ctx === null) {
      this.smoke = [];
      this.flames = [];
      return;
    }
    this.source = new CanvasSource({ resource: ctx.canvas, scaleMode: 'linear' });
    const smoke: Texture[] = [];
    const flames: Texture[] = [];
    for (let tile = 0; tile < FIRE_FRAMES + 4; tile++) {
      const x = (tile % 8) * TILE;
      const y = Math.floor(tile / 8) * TILE;
      const image = ctx.createImageData(TILE, TILE);
      if (tile < 4) paintSmoke(image.data, tile);
      else paintFire(image.data, tile - 4);
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

function paintFire(data: Uint8ClampedArray, frame: number): void {
  const phase = (frame / FIRE_FRAMES) * Math.PI * 2;
  for (let y = 3; y < TILE - 3; y++)
    for (let x = 3; x < TILE - 3; x++) {
      const up = (59 - y) / 55;
      const wave = Math.sin(up * 9 - phase) * 4 + Math.sin(up * 17 - phase * 2) * 2.8;
      let field = 0;
      for (let tongue = 0; tongue < 3; tongue++) {
        const centre = 32 + (tongue - 1) * 6 + wave * up + Math.sin(phase + tongue * 2 + up * 6) * up * 3;
        const height = 0.69 + 0.16 * Math.sin(phase + tongue * 2.1) + (tongue === 1 ? 0.14 : 0);
        const width = clamp01(1 - up / height) ** 0.65 * (9 + 2 * Math.sin(phase * 2 + tongue));
        if (width <= 0) continue;
        field = Math.max(field, (1 - Math.abs(x - centre) / width) * clamp01((height - up) * 8));
      }
      const flow = smoothNoise(x / 5 + Math.sin(phase) * 0.4, y / 7 + (frame * 8) / FIRE_FRAMES, 43, 8);
      const wisps = smoothNoise(x / 2.5, y / 4 + (frame * 8) / FIRE_FRAMES, 81, 8);
      const density = field - flow * (0.28 + up * 0.65) - wisps * 0.25;
      const baseFade = clamp01((60 - y) / 9);
      const heat = clamp01(density * 1.7) ** 0.85 * (1 - up * 0.45);
      if (field <= 0 || density <= 0) continue;
      const at = (y * TILE + x) * 4;
      data[at] = 218 + heat * 37;
      data[at + 1] = 63 + heat * 165;
      data[at + 2] = 12 + heat ** 4 * 130;
      data[at + 3] = clamp01(density * 2.7) * baseFade * 235;
    }
}
