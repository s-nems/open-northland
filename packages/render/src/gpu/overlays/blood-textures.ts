import { BufferImageSource, Rectangle, Texture } from 'pixi.js';
import { frac } from '../../data/effects/random.js';

const CELL = 32;
const VARIANTS = 16;
const COLUMNS = 8;

/** A shared, small raster atlas: torn edges and granular coverage, with no circular outlines.
 * Generated from our own shapes; no game assets or per-mark canvas/GPU surfaces. */
export class BloodTextures {
  private readonly source: BufferImageSource;
  readonly stains: readonly Texture[];
  readonly drop: Texture;

  constructor() {
    const width = CELL * COLUMNS;
    const height = CELL * 3;
    const pixels = new Uint8Array(width * height * 4);
    for (let variant = 0; variant < VARIANTS; variant++) {
      const seed = variant * 7919 + 17;
      const lobes = Array.from({ length: 7 }, (_, i) => ({
        x: (frac(seed, i * 4) - 0.5) * 15,
        y: (frac(seed, i * 4 + 1) - 0.5) * 13,
        rx: 2 + frac(seed, i * 4 + 2) * 6,
        ry: 2 + frac(seed, i * 4 + 3) * 5,
      }));
      for (let y = 0; y < CELL; y++) {
        for (let x = 0; x < CELL; x++) {
          let field = 0;
          for (const lobe of lobes) {
            const dx = (x - CELL / 2 - lobe.x) / lobe.rx;
            const dy = (y - CELL / 2 - lobe.y) / lobe.ry;
            field = Math.max(field, 1 - dx * dx - dy * dy);
          }
          const grain = frac(seed, 100 + y * CELL + x);
          const coverage = Math.min(1, Math.max(0, field * 3 + (grain - 0.5) * 0.6));
          const value = Math.round(175 + grain * 70);
          const offset = (((variant >> 3) * CELL + y) * width + (variant % COLUMNS) * CELL + x) * 4;
          pixels.set([value, value, value, Math.round(coverage * (0.68 + grain * 0.27) * 255)], offset);
        }
      }
    }
    // A small asymmetric droplet; its long axis is x, aligned to instantaneous velocity by the layer.
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const dx = (x - 3.5) / 3.2;
        const dy = (y - 3.5) / (1.5 + x * 0.1);
        const edge = Math.max(0, Math.min(1, (1 - dx * dx - dy * dy) * 2));
        const light = Math.round(190 + 45 * edge);
        pixels.set([light, light, light, Math.round(edge * 255)], ((CELL * 2 + y) * width + x) * 4);
      }
    }
    this.source = new BufferImageSource({
      resource: pixels,
      width,
      height,
      scaleMode: 'linear',
      autoGenerateMipmaps: false,
    });
    this.stains = Array.from(
      { length: VARIANTS },
      (_, i) =>
        new Texture({
          source: this.source,
          frame: new Rectangle((i % COLUMNS) * CELL, (i >> 3) * CELL, CELL, CELL),
        }),
    );
    this.drop = new Texture({ source: this.source, frame: new Rectangle(0, CELL * 2, 8, 8) });
  }

  stain(seed: number): Texture {
    return this.stains[seed % VARIANTS] ?? this.drop;
  }

  destroy(): void {
    for (const texture of this.stains) texture.destroy();
    this.drop.destroy();
    this.source.destroy();
  }
}
