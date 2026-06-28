import type { Camera, DrawItem } from '@vinland/render';

/**
 * Camera helpers shared by the live (`main.ts`) and shot (`shot.ts`) entries. Pure geometry over the
 * draw list — no Pixi, no sim. The `?zoom=` knob exists so a human can actually judge a decoded bob's
 * pixels: a ~30px sprite is lost on a 960px canvas, so a verification frame magnifies and re-centres.
 */

/** Parse a positive-float URL param (e.g. `?zoom=4`), falling back when absent or invalid. */
export function floatParam(params: URLSearchParams, name: string, fallback: number): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Build the camera for a frame. At zoom 1 it keeps the historical pan (the iso strip projects to
 * negative screen-x, so the offset nudges it into view). At a higher zoom it centres on the CENTROID of
 * the SETTLERS (the camera follows the people — they're the animated subjects a pixel check inspects),
 * falling back to all non-tile sprites, then the origin. This frames a small decoded bob reliably rather
 * than letting the big placeholder boxes drag the focus off it. `screen = world*scale + offset` (see
 * {@link Camera}).
 */
export function cameraFor(scene: readonly DrawItem[], zoom: number, width: number, height: number): Camera {
  if (zoom === 1) return { offsetX: width / 2, offsetY: height / 3 };
  const focus = centroid(scene, (k) => k === 'settler') ?? centroid(scene, (k) => k !== 'tile') ?? null;
  const focusX = focus?.x ?? 0;
  const focusY = focus?.y ?? 0;
  return { offsetX: width / 2 - focusX * zoom, offsetY: height / 2 - focusY * zoom, scale: zoom };
}

/** Mean (x,y) of the draw items whose kind passes `keep`, or null when none match. */
function centroid(
  scene: readonly DrawItem[],
  keep: (kind: DrawItem['kind']) => boolean,
): { x: number; y: number } | null {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const item of scene) {
    if (!keep(item.kind)) continue;
    sumX += item.x;
    sumY += item.y;
    count++;
  }
  return count > 0 ? { x: sumX / count, y: sumY / count } : null;
}
