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
