import { CanvasSource, Rectangle, Texture, type TextureSource } from 'pixi.js';
import type { AtlasFrame } from '../data/sprites/index.js';
import { isDrawableResource, readable2dContext } from './drawable-resource.js';

/** Binomial blur taps, in source pixels, applied along each axis. */
export const SHADOW_BLUR_KERNEL = [1, 4, 6, 4, 1] as const;
export const SHADOW_BLUR_RADIUS = (SHADOW_BLUR_KERNEL.length - 1) / 2;
/** Source pixels a softened silhouette grows by per side: the kernel's reach plus the linear
 *  magnification's one-pixel footprint. */
export const SHADOW_BLUR_PADDING = SHADOW_BLUR_RADIUS + 1;
export const SHADOW_BLUR_KERNEL_SUM = SHADOW_BLUR_KERNEL.reduce((sum, tap) => sum + tap, 0);
const MAX_PIXELS = 2 * 1024 * 1024;
const MAX_FRAME_PIXELS = 512 * 512;

/** Artistic approximation: a one-source-pixel Gaussian softens the existing black silhouette.
 * Padding isolates its edge from atlas neighbours; alpha is never amplified. */
export function softenShadowAlpha(data: Uint8ClampedArray, width: number, height: number): void {
  const horizontal = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let alpha = 0;
      for (let k = 0; k < SHADOW_BLUR_KERNEL.length; k++) {
        const sx = x + k - SHADOW_BLUR_RADIUS;
        if (sx >= 0 && sx < width)
          alpha += (data[(y * width + sx) * 4 + 3] ?? 0) * (SHADOW_BLUR_KERNEL[k] ?? 0);
      }
      horizontal[y * width + x] = alpha / SHADOW_BLUR_KERNEL_SUM;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let alpha = 0;
      for (let k = 0; k < SHADOW_BLUR_KERNEL.length; k++) {
        const sy = y + k - SHADOW_BLUR_RADIUS;
        if (sy >= 0 && sy < height) alpha += (horizontal[sy * width + x] ?? 0) * (SHADOW_BLUR_KERNEL[k] ?? 0);
      }
      const i = (y * width + x) * 4;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = alpha / SHADOW_BLUR_KERNEL_SUM;
    }
  }
}

/** Demand-baked frames have a fixed 8 MiB RGBA budget (plus the CPU canvas copies).
 * Overflow uses the original: evicting textures could invalidate retained off-screen sprites. */
export class SoftShadowCache {
  private readonly textures = new Map<AtlasFrame, Texture>();
  private unavailable = new WeakSet<AtlasFrame>();
  private pixels = 0;

  get(source: TextureSource, frame: AtlasFrame): Texture | null {
    const cached = this.textures.get(frame);
    if (cached !== undefined) return cached;
    if (this.unavailable.has(frame)) return null;
    const width = frame.width + SHADOW_BLUR_PADDING * 2;
    const height = frame.height + SHADOW_BLUR_PADDING * 2;
    const pixels = width * height;
    if (pixels > MAX_FRAME_PIXELS || this.pixels + pixels > MAX_PIXELS) return null;
    const resource: unknown = source.resource;
    if (!isDrawableResource(resource)) {
      this.unavailable.add(frame);
      return null;
    }
    const ctx = readable2dContext(width, height);
    if (ctx === null) {
      this.unavailable.add(frame);
      return null;
    }
    try {
      ctx.drawImage(
        resource,
        frame.x,
        frame.y,
        frame.width,
        frame.height,
        SHADOW_BLUR_PADDING,
        SHADOW_BLUR_PADDING,
        frame.width,
        frame.height,
      );
      const image = ctx.getImageData(0, 0, width, height);
      softenShadowAlpha(image.data, width, height);
      ctx.putImageData(image, 0, 0);
      const texture = new Texture({
        source: new CanvasSource({ resource: ctx.canvas, scaleMode: 'linear' }),
        orig: new Rectangle(0, 0, frame.width, frame.height),
        // Negative trim extends the sprite geometry while retaining the original feet anchor.
        trim: new Rectangle(-SHADOW_BLUR_PADDING, -SHADOW_BLUR_PADDING, width, height),
      });
      this.textures.set(frame, texture);
      this.pixels += pixels;
      return texture;
    } catch {
      this.unavailable.add(frame);
      return null;
    }
  }

  clear(): void {
    for (const texture of this.textures.values()) texture.destroy(true);
    this.textures.clear();
    this.unavailable = new WeakSet();
    this.pixels = 0;
  }
}
