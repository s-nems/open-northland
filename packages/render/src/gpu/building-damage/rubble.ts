import { Graphics } from 'pixi.js';
import { clamp01 } from '../../data/math.js';
import { worldBatched } from '../world-batcher.js';
import { noise } from './surface.js';

export interface GroundContact {
  readonly x: number;
  readonly y: number;
  readonly colour: number;
}

/** Follow the body's lower silhouette, including sloped isometric walls, rather than a flat bounds line. */
export function groundContacts(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  scale: number,
): readonly GroundContact[] {
  const points: GroundContact[] = [];
  for (let i = 0; i < 13; i++) {
    const px = Math.round(w * (0.08 + i * 0.07));
    let py = h - 1;
    while (py >= h * 0.45 && (pixels[(py * w + px) * 4 + 3] ?? 0) < 180) py--;
    if (py < h * 0.45) continue;
    const at = (Math.max(0, py - 2) * w + px) * 4;
    const colour = ((pixels[at] ?? 100) << 16) | ((pixels[at + 1] ?? 85) << 8) | (pixels[at + 2] ?? 66);
    points.push({ x: x + px * scale, y: y + py * scale, colour });
  }
  return points;
}

/** Dirt, stone chips and splinters accumulate in place. One retained mesh, rebuilt only on damage changes. */
export class DamageRubble {
  readonly graphics = worldBatched(new Graphics());
  private points: readonly GroundContact[] | undefined;
  private level = -1;

  constructor(private readonly seed: number) {
    // Critical rubble exceeds Pixi's automatic vertex threshold but still belongs in the world batch.
    this.graphics.context.batchMode = 'batch';
  }

  draw(points: readonly GroundContact[], damage: number, enabled: boolean): void {
    const level = enabled ? damage : 0;
    if (this.points === points && this.level === level) return;
    this.points = points;
    this.level = level;
    const g = this.graphics;
    g.clear();
    if (level === 0 || points.length === 0) return;
    const dust = clamp01(level / 3);
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      if (point === undefined) continue;
      const x = point.x + (noise(this.seed, i + 610) - 0.5) * 7;
      const y = point.y + 2 + noise(this.seed, i + 620) * 3;
      const width = (3 + noise(this.seed, i + 630) * 5) * (0.75 + level * 0.13);
      g.ellipse(x, y + 1, width * 1.5, width * 0.42).fill({ color: 0x958367, alpha: dust * 0.14 });
      g.ellipse(x, y, width, width * 0.25).fill({ color: 0x6f624a, alpha: dust * 0.17 });
    }
    const count = 7 + Math.ceil(level * 9);
    for (let i = 0; i < count; i++) {
      const visibility = clamp01((level * 9 - Math.max(0, i - 6)) * 0.5);
      if (visibility === 0) continue;
      const point = points[Math.floor(noise(this.seed, i + 400) * points.length)];
      if (point === undefined) continue;
      const x = point.x + (noise(this.seed, i + 410) - 0.5) * (i < 12 ? 9 : 20);
      const y = point.y + 1 + noise(this.seed, i + 420) * (i < 12 ? 7 : 16);
      const size = (i < 12 ? 0.7 : 0.9) + noise(this.seed, i + 430) * (i < 12 ? 1.3 : 2.6);
      g.ellipse(x, y + 1, size * 2.4, size * 0.7).fill({ color: 0x4c412c, alpha: 0.15 * visibility });
      if (i % 4 === 0) {
        const dx = size * (2 + noise(this.seed, i + 440) * 2);
        const dy = (noise(this.seed, i + 450) - 0.5) * dx;
        g.poly([x - dx, y - dy, x + dx, y + dy, x + dx * 0.65, y + dy + 1, x - dx * 0.8, y - dy + 1.4]).fill({
          color: 0x7c6445,
          alpha: visibility,
        });
        g.moveTo(x - dx, y - dy)
          .lineTo(x + dx * 0.7, y + dy)
          .stroke({ color: 0xb39b74, width: 0.65, alpha: 0.65 * visibility });
      } else {
        g.poly([
          x - size,
          y,
          x - size * 0.45,
          y - size * 0.8,
          x + size,
          y - size * 0.25,
          x + size * 0.6,
          y + size * 0.6,
        ]).fill({ color: point.colour, alpha: 0.9 * visibility });
        g.moveTo(x - size, y)
          .lineTo(x - size * 0.45, y - size * 0.8)
          .lineTo(x + size, y - size * 0.25)
          .stroke({ color: 0xd0c4a9, width: 0.6, alpha: 0.35 * visibility });
      }
    }
  }
}
