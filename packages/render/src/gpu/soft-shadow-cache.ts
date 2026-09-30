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
const PAGE_SIDE = 512;
type BakeContext = NonNullable<ReturnType<typeof readable2dContext>>;
interface ShadowRow {
  x: number;
  readonly y: number;
  readonly height: number;
}
interface ShadowPage {
  readonly ctx: BakeContext;
  readonly source: CanvasSource;
  readonly rows: ShadowRow[];
}
/** Pixels one budgeted frame may bake. A bake is synchronous, so without a ceiling, switching the
 *  enhancement on over a settled town softens every visible caster inside that one frame. One frame of
 *  the largest allowed silhouette still fits, so a backlog always drains. */
const MAX_PIXELS_PER_FRAME = MAX_FRAME_PIXELS;

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

/** Demand-baked frames have a fixed 8 MiB useful RGBA budget, plus atlas gaps and CPU canvas copies.
 * Overflow uses the original: evicting textures could invalidate retained off-screen sprites. */
export class SoftShadowCache {
  private readonly textures = new Map<AtlasFrame, Texture>();
  private readonly pages: ShadowPage[] = [];
  private scratch: BakeContext | null = null;
  private unavailable = new WeakSet<AtlasFrame>();
  private pixels = 0;
  private framePixels = 0;
  private deferred = false;
  /** The per-frame ceiling binds only a frame its owner opens as budgeted. A cache driven outside a draw
   *  loop, such as an art-gallery preview, would otherwise spend its one budget and never bake again. */
  private budgeted = false;

  /** Whether the frame just drawn ran out of bake budget, so some callers still hold hard silhouettes
   *  and need to ask again. */
  get deferredBakes(): boolean {
    return this.deferred;
  }

  /** Opens a drawn frame; an unbudgeted one softens every caster it asks for. */
  beginFrame(budgeted: boolean): void {
    this.budgeted = budgeted;
    this.framePixels = 0;
    this.deferred = false;
  }

  get(source: TextureSource, frame: AtlasFrame): Texture | null {
    const cached = this.textures.get(frame);
    if (cached !== undefined) return cached;
    if (this.unavailable.has(frame)) return null;
    const width = frame.width + SHADOW_BLUR_PADDING * 2;
    const height = frame.height + SHADOW_BLUR_PADDING * 2;
    const pixels = width * height;
    if (pixels > MAX_FRAME_PIXELS || this.pixels + pixels > MAX_PIXELS) return null;
    if (this.budgeted && this.framePixels > 0 && this.framePixels + pixels > MAX_PIXELS_PER_FRAME) {
      this.deferred = true;
      return null;
    }
    const resource: unknown = source.resource;
    if (!isDrawableResource(resource)) {
      this.unavailable.add(frame);
      return null;
    }
    this.scratch ??= readable2dContext(width, height);
    const ctx = this.scratch;
    if (ctx === null) {
      this.unavailable.add(frame);
      return null;
    }
    try {
      const scratchWidth = Math.max(ctx.canvas.width, width);
      const scratchHeight = Math.max(ctx.canvas.height, height);
      if (scratchWidth * scratchHeight > MAX_FRAME_PIXELS) {
        ctx.canvas.width = 1;
        ctx.canvas.height = height;
        ctx.canvas.width = width;
      } else {
        if (ctx.canvas.width < width) ctx.canvas.width = width;
        if (ctx.canvas.height < height) ctx.canvas.height = height;
      }
      ctx.clearRect(0, 0, width, height);
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
      const placement = this.pageFor(width, height);
      if (placement === null) return null;
      const { page, row } = placement;
      const x = row.x,
        y = row.y;
      page.ctx.putImageData(image, x, y);
      page.source.update();
      row.x += width;
      const texture = new Texture({
        source: page.source,
        frame: new Rectangle(x, y, width, height),
        orig: new Rectangle(0, 0, frame.width, frame.height),
        // Negative trim extends the sprite geometry while retaining the original feet anchor.
        trim: new Rectangle(-SHADOW_BLUR_PADDING, -SHADOW_BLUR_PADDING, width, height),
      });
      this.textures.set(frame, texture);
      this.pixels += pixels;
      this.framePixels += pixels;
      return texture;
    } catch {
      this.unavailable.add(frame);
      return null;
    }
  }

  private pageFor(width: number, height: number): { page: ShadowPage; row: ShadowRow } | null {
    for (const page of this.pages) {
      for (const row of page.rows) {
        // Similar-height frames share fixed shelves; a thin frame cannot consume a tall shelf's width.
        if (height > row.height || height * 2 < row.height) continue;
        if (row.x + width <= page.ctx.canvas.width) return { page, row };
      }
      const last = page.rows[page.rows.length - 1];
      const y = last === undefined ? 0 : last.y + last.height;
      if (width <= page.ctx.canvas.width && y + height <= page.ctx.canvas.height) {
        const row = { x: 0, y, height };
        page.rows.push(row);
        return { page, row };
      }
    }
    // An oversized thin frame owns a tight page rather than padding its other axis to 512 pixels.
    const oversized = width > PAGE_SIDE || height > PAGE_SIDE;
    const ctx = readable2dContext(oversized ? width : PAGE_SIDE, oversized ? height : PAGE_SIDE);
    if (ctx === null) return null;
    const row = { x: 0, y: 0, height };
    const page: ShadowPage = {
      ctx,
      source: new CanvasSource({ resource: ctx.canvas, scaleMode: 'linear' }),
      rows: [row],
    };
    this.pages.push(page);
    return { page, row };
  }

  clear(): void {
    for (const texture of this.textures.values()) texture.destroy(false);
    for (const page of this.pages) page.source.destroy();
    this.pages.length = 0;
    this.scratch = null;
    this.textures.clear();
    this.unavailable = new WeakSet();
    this.pixels = 0;
    this.framePixels = 0;
    this.deferred = false;
    this.budgeted = false;
  }
}
