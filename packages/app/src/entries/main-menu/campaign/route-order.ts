/** A route picture's RGBA pixels, row by row. */
export interface RoutePixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: ArrayLike<number>;
}

const CHANNELS = 4;
const ALPHA = 3;
/** Alpha below this is the picture's soft edge, not part of a dot. */
const OPAQUE = 32;
/** Marks a transparent pixel in the order. */
export const NOT_ON_ROUTE = -1;

interface Dot {
  readonly pixels: number[];
  readonly x: number;
  readonly y: number;
}

/** The picture's dots: 8-connected runs of opaque pixels, with their centres. */
function dotsOf({ width, height, rgba }: RoutePixels): Dot[] {
  const seen = new Uint8Array(width * height);
  const dots: Dot[] = [];
  for (let first = 0; first < width * height; first++) {
    if (seen[first] === 1 || (rgba[first * CHANNELS + ALPHA] ?? 0) < OPAQUE) continue;
    seen[first] = 1;
    const pixels: number[] = [];
    const stack = [first];
    let sumX = 0;
    let sumY = 0;
    for (let index = stack.pop(); index !== undefined; index = stack.pop()) {
      pixels.push(index);
      const x = index % width;
      const y = (index - x) / width;
      sumX += x;
      sumY += y;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (seen[next] === 1 || (rgba[next * CHANNELS + ALPHA] ?? 0) < OPAQUE) continue;
          seen[next] = 1;
          stack.push(next);
        }
    }
    dots.push({ pixels, x: sumX / pixels.length, y: sumY / pixels.length });
  }
  return dots;
}

/**
 * Each pixel's place along the dotted route, from 0 at the dot nearest `start` to 1 at the far end,
 * or `NOT_ON_ROUTE`. The route is followed dot to nearest dot, so a path that bends back on itself
 * still draws in walking order.
 */
export function routeOrder(
  picture: RoutePixels,
  start: { readonly x: number; readonly y: number },
): Float32Array {
  const order = new Float32Array(picture.width * picture.height).fill(NOT_ON_ROUTE);
  const left = dotsOf(picture);
  const walked: { dot: Dot; distance: number }[] = [];
  let at = start;
  let distance = 0;
  while (left.length > 0) {
    let nearest = 0;
    let best = Number.POSITIVE_INFINITY;
    for (const [index, dot] of left.entries()) {
      const gap = Math.hypot(dot.x - at.x, dot.y - at.y);
      if (gap < best) {
        best = gap;
        nearest = index;
      }
    }
    const [dot] = left.splice(nearest, 1);
    if (dot === undefined) break;
    if (walked.length > 0) distance += best;
    walked.push({ dot, distance });
    at = dot;
  }
  for (const { dot, distance: along } of walked) {
    const place = distance > 0 ? along / distance : 1;
    for (const pixel of dot.pixels) order[pixel] = place;
  }
  return order;
}
