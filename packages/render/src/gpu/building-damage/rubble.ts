import { Graphics } from 'pixi.js';
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
  private stage = -1;

  constructor(private readonly seed: number) {
    // Critical rubble exceeds Pixi's automatic vertex threshold but still belongs in the world batch.
    this.graphics.context.batchMode = 'batch';
  }

  draw(points: readonly GroundContact[], stage: number, enabled: boolean): void {
    const level = enabled ? stage : 0;
    if (this.points === points && this.stage === level) return;
    this.points = points;
    this.stage = level;
    const g = this.graphics;
    g.clear();
    if (level === 0 || points.length === 0) return;
    const count = 3 + level * 5;
    for (let i = 0; i < count; i++) {
      const point = points[Math.floor(noise(this.seed, i + 400) * points.length)];
      if (point === undefined) continue;
      const x = point.x + (noise(this.seed, i + 410) - 0.5) * 13;
      const y = point.y + 1 + noise(this.seed, i + 420) * 10;
      const size = 0.7 + noise(this.seed, i + 430) * (i < 8 ? 1 : 2.2);
      g.ellipse(x, y + 1, size * 2.4, size * 0.7).fill({ color: 0x4c412c, alpha: 0.15 });
      if (i % 4 === 0) {
        const dx = size * (2 + noise(this.seed, i + 440) * 2);
        const dy = (noise(this.seed, i + 450) - 0.5) * dx;
        g.poly([x - dx, y - dy, x + dx, y + dy, x + dx * 0.65, y + dy + 1, x - dx * 0.8, y - dy + 1.4]).fill(
          0x7c6445,
        );
        g.moveTo(x - dx, y - dy)
          .lineTo(x + dx * 0.7, y + dy)
          .stroke({ color: 0xb39b74, width: 0.65, alpha: 0.65 });
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
        ]).fill({ color: point.colour, alpha: 0.9 });
        g.moveTo(x - size, y)
          .lineTo(x - size * 0.45, y - size * 0.8)
          .lineTo(x + size, y - size * 0.25)
          .stroke({ color: 0xd0c4a9, width: 0.6, alpha: 0.35 });
      }
    }
  }
}
