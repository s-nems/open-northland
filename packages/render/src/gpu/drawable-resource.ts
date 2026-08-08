/** The image kinds a Pixi `TextureSource.resource` can be that a 2d canvas can draw for pixel readback. */
export type DrawableResource = Exclude<CanvasImageSource, SVGImageElement | VideoFrame>;

export function isDrawableResource(resource: unknown): resource is DrawableResource {
  return (
    (typeof ImageBitmap !== 'undefined' && resource instanceof ImageBitmap) ||
    (typeof HTMLImageElement !== 'undefined' && resource instanceof HTMLImageElement) ||
    (typeof HTMLCanvasElement !== 'undefined' && resource instanceof HTMLCanvasElement) ||
    (typeof OffscreenCanvas !== 'undefined' && resource instanceof OffscreenCanvas)
  );
}

/**
 * A fresh `width`×`height` 2d context for reading pixels back (`willReadFrequently` so the platform keeps
 * it CPU-side), or `null` when no canvas or context is available. Never throws; the caller degrades.
 */
export function readable2dContext(
  width: number,
  height: number,
): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null {
  try {
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : (() => {
            const c = document.createElement('canvas');
            c.width = width;
            c.height = height;
            return c;
          })();
    return canvas.getContext('2d', { willReadFrequently: true }) as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;
  } catch {
    return null;
  }
}
