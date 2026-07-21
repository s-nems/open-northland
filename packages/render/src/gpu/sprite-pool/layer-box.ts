import type { ResolvedLayer } from './resolve-layers.js';

/**
 * Where one resolved layer draws and the box its layers union into, in feet-local px about the container
 * origin. Filled in place: this runs per drawn layer per visible entity per frame.
 */

/** `ox`/`oy` are the layer's uncropped rect, `drawnOy` where the (possibly cropped) texture lands.
 *  `hiddenTop` is in atlas texels; every other field is scaled px. */
export interface LayerDrawBox {
  ox: number;
  oy: number;
  drawnOy: number;
  hiddenTop: number;
  width: number;
  height: number;
}

export function createLayerDrawBox(): LayerDrawBox {
  return { ox: 0, oy: 0, drawnOy: 0, hiddenTop: 0, width: 0, height: 0 };
}

/**
 * A reveal layer without per-pixel time data falls back to the bottom-up crop: only its bottom
 * `displayReveal` fraction draws, shifted down so its base stays put — the building rising out of the
 * ground. `perPixelReveal` says the caller bound a baked TimeMask instead, which crops nothing.
 *
 * The uncropped rect is what bounds are stamped from: a construction site is picked over the final
 * building's whole box, so a barely-started foundation stays clickable over its plot.
 */
export function layerDrawBox(
  out: LayerDrawBox,
  layer: ResolvedLayer,
  displayReveal: number | undefined,
  perPixelReveal: boolean,
): void {
  out.ox = layer.frame.offsetX * layer.scale;
  out.oy = layer.frame.offsetY * layer.scale;
  out.hiddenTop =
    !perPixelReveal && layer.reveal !== undefined && displayReveal !== undefined
      ? Math.round((1 - displayReveal) * layer.frame.height)
      : 0;
  out.drawnOy = out.oy + out.hiddenTop * layer.scale;
  out.width = layer.frame.width * layer.scale;
  out.height = layer.frame.height * layer.scale;
}

/** A reusable AABB accumulator — one instance per pool, {@link reset} per entity. Empty until first
 *  {@link add}, which the inverted initial extents encode. */
export class BoundsUnion {
  minX = Number.POSITIVE_INFINITY;
  minY = Number.POSITIVE_INFINITY;
  maxX = Number.NEGATIVE_INFINITY;
  maxY = Number.NEGATIVE_INFINITY;

  reset(): void {
    this.minX = Number.POSITIVE_INFINITY;
    this.minY = Number.POSITIVE_INFINITY;
    this.maxX = Number.NEGATIVE_INFINITY;
    this.maxY = Number.NEGATIVE_INFINITY;
  }

  add(minX: number, minY: number, maxX: number, maxY: number): void {
    if (minX < this.minX) this.minX = minX;
    if (minY < this.minY) this.minY = minY;
    if (maxX > this.maxX) this.maxX = maxX;
    if (maxY > this.maxY) this.maxY = maxY;
  }

  isEmpty(): boolean {
    return this.minX > this.maxX;
  }
}
