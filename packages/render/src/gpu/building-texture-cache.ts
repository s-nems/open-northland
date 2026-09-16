import { CanvasSource, Rectangle, Texture, type TextureSource } from 'pixi.js';
import type { AtlasFrame } from '../data/sprites/index.js';
import { isDrawableResource, readable2dContext } from './drawable-resource.js';

const PADDING = 2;
const MAX_GPU_BYTES = 32 * 1024 * 1024;
const MAX_FRAME_PIXELS = 1024 * 1024;

/** Artistic approximation: restore a little native-size interior contrast without sharpening
 * silhouettes. The two-pixel opaque neighbourhood excludes both alpha edges and their neighbours. */
export function sharpenBuildingInterior(data: Uint8ClampedArray, width: number, height: number): void {
  if (width < 5 || height < 5) return;
  const original = data.slice();
  // RGB columns cover three rows; alpha columns count fully opaque pixels across five rows.
  // Rolling both windows keeps work constant per pixel without allocating full-image sum tables.
  const columns = new Uint16Array(width * 4);
  for (let x = 0; x < width; x++) {
    const col = x * 4;
    for (let channel = 0; channel < 3; channel++) {
      columns[col + channel] =
        (original[(width + x) * 4 + channel] ?? 0) +
        (original[(2 * width + x) * 4 + channel] ?? 0) +
        (original[(3 * width + x) * 4 + channel] ?? 0);
    }
    for (let y = 0; y < 5; y++) {
      if (original[(y * width + x) * 4 + 3] === 255) columns[col + 3] = (columns[col + 3] ?? 0) + 1;
    }
  }
  const sums = new Uint16Array(3);
  for (let y = 2; y < height - 2; y++) {
    for (let channel = 0; channel < 3; channel++) {
      sums[channel] =
        (columns[4 + channel] ?? 0) + (columns[8 + channel] ?? 0) + (columns[12 + channel] ?? 0);
    }
    let opaque = 0;
    for (let x = 0; x < 5; x++) opaque += columns[x * 4 + 3] ?? 0;
    for (let x = 2; x < width - 2; x++) {
      const i = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const sum = sums[channel] ?? 0;
        if (opaque === 25) {
          const value = original[i + channel] ?? 0;
          data[i + channel] = value + Math.max(-8, Math.min(8, (value - sum / 9) * 0.2));
        }
        sums[channel] = sum - (columns[(x - 1) * 4 + channel] ?? 0) + (columns[(x + 2) * 4 + channel] ?? 0);
      }
      opaque += (columns[(x + 3) * 4 + 3] ?? 0) - (columns[(x - 2) * 4 + 3] ?? 0);
    }
    if (y === height - 3) break;
    for (let x = 0; x < width; x++) {
      const col = x * 4;
      for (let channel = 0; channel < 3; channel++) {
        columns[col + channel] =
          (columns[col + channel] ?? 0) -
          (original[((y - 1) * width + x) * 4 + channel] ?? 0) +
          (original[((y + 2) * width + x) * 4 + channel] ?? 0);
      }
      columns[col + 3] =
        (columns[col + 3] ?? 0) -
        Number(original[((y - 2) * width + x) * 4 + 3] === 255) +
        Number(original[((y + 3) * width + x) * 4 + 3] === 255);
    }
  }
}

function mipBytes(width: number, height: number): number {
  let bytes = width * height * 4;
  while (width > 1 || height > 1) {
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
    bytes += width * height * 4;
  }
  return bytes;
}

/** Each frame is isolated before mip generation, so atlas neighbours cannot contaminate roof detail.
 * Retained GPU pixels including mips are capped at 32 MiB, plus at most 32 MiB of CPU canvas copies.
 * No eviction: even detached pooled sprites can retain a texture until they next enter the viewport. */
export class BuildingTextureCache {
  private readonly textures = new Map<AtlasFrame, Texture>();
  private unavailable = new WeakSet<AtlasFrame>();
  private gpuBytes = 0;

  get(source: TextureSource, frame: AtlasFrame): Texture | null {
    // Authored assets already have their own mip policy; never bake them again.
    if (source.autoGenerateMipmaps || source.mipLevelCount > 1) return null;
    const cached = this.textures.get(frame);
    if (cached !== undefined) return cached;
    if (this.unavailable.has(frame)) return null;
    const width = frame.width + PADDING * 2;
    const height = frame.height + PADDING * 2;
    if (width * height > MAX_FRAME_PIXELS || frame.width <= 0 || frame.height <= 0) return null;
    const bytes = mipBytes(width, height);
    if (this.gpuBytes + bytes > MAX_GPU_BYTES) return null;
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
        PADDING,
        PADDING,
        frame.width,
        frame.height,
      );
      const image = ctx.getImageData(0, 0, width, height);
      sharpenBuildingInterior(image.data, width, height);
      ctx.putImageData(image, 0, 0);
      const texture = new Texture({
        source: new CanvasSource({
          resource: ctx.canvas,
          scaleMode: 'linear',
          autoGenerateMipmaps: true,
        }),
        // Keep the drawn extent and pixel-picking coordinates identical to the original frame.
        frame: new Rectangle(PADDING, PADDING, frame.width, frame.height),
      });
      this.textures.set(frame, texture);
      this.gpuBytes += bytes;
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
    this.gpuBytes = 0;
  }
}
