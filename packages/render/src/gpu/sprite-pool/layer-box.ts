import type { ResolvedLayer } from './resolved-layer.js';

/**
 * Layer geometry in feet-local px about the container origin, filled in place: this runs per drawn layer
 * per visible entity per frame.
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
 * `displayReveal` fraction draws, shifted down so its base stays put. `perPixelReveal` says the caller
 * bound a baked TimeMask instead, which crops nothing.
 */
export function layerDrawBox(
  out: LayerDrawBox,
  layer: ResolvedLayer,
  displayReveal: number | undefined,
  perPixelReveal: boolean,
): void {
  out.ox = layer.frame.offsetX * layer.scale + (layer.dx ?? 0);
  out.oy = layer.frame.offsetY * layer.scale + (layer.dy ?? 0);
  out.hiddenTop =
    !perPixelReveal && layer.reveal !== undefined && displayReveal !== undefined
      ? Math.round((1 - displayReveal) * layer.frame.height)
      : 0;
  out.drawnOy = out.oy + out.hiddenTop * layer.scale;
  out.width = layer.frame.width * layer.scale;
  out.height = layer.frame.height * layer.scale;
}

/** A reusable AABB accumulator, empty until the first {@link add} - which the inverted initial extents
 *  encode. */
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

/** Add `box` turned `tilt` radians clockwise about its bottom-centre, then sheared as its mesh draws it. */
export function addTiltedBox(bounds: BoundsUnion, box: LayerDrawBox, tilt: number, shear: number): void {
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  const pivotX = box.ox + box.width / 2;
  const pivotY = box.oy + box.height;
  for (let corner = 0; corner < 4; corner++) {
    const fromX = (corner & 1) === 0 ? -box.width / 2 : box.width / 2;
    const fromY = (corner & 2) === 0 ? -box.height : 0;
    const y = pivotY + fromX * sin + fromY * cos;
    const x = pivotX + fromX * cos - fromY * sin + shear * y;
    bounds.add(x, y, x, y);
  }
}
