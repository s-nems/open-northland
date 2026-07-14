/**
 * The CPU-readable image kinds a loaded Pixi texture's `TextureSource.resource` can be — shared by the
 * consumers that need the atlas pixels back off the loaded image (the pick alpha masks, the construction
 * reveal bakes). Everything else (a render texture, a compressed source) is not canvas-drawable and the
 * caller degrades.
 */
export type DrawableResource = Exclude<CanvasImageSource, SVGImageElement | VideoFrame>;

/** Whether `resource` can be drawn onto a 2d canvas to read its pixels. */
export function isDrawableResource(resource: unknown): resource is DrawableResource {
  return (
    (typeof ImageBitmap !== 'undefined' && resource instanceof ImageBitmap) ||
    (typeof HTMLImageElement !== 'undefined' && resource instanceof HTMLImageElement) ||
    (typeof HTMLCanvasElement !== 'undefined' && resource instanceof HTMLCanvasElement) ||
    (typeof OffscreenCanvas !== 'undefined' && resource instanceof OffscreenCanvas)
  );
}

/**
 * A fresh `width`×`height` 2d context for reading a drawable's pixels back (`willReadFrequently` so the
 * platform keeps it CPU-side), or `null` when no canvas/context is available — a headless env without
 * `OffscreenCanvas` or `document`, or a context the platform refuses. Never throws; the caller degrades.
 * The shared readback surface behind the alpha-mask build and the construction-reveal bake.
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
