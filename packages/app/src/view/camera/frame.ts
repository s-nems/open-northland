import { type Camera, type DrawItem, tileToScreen } from '@open-northland/render';

/**
 * Static starting-frame builders — the pure geometry half of the camera. No Pixi, no sim, no DOM: each
 * maps world/tile points to a {@link Camera} frame (`screen = world*scale + offset`). The interactive
 * entries wrap the DOM controller (`controller.ts`) around the frame one of these produces; the
 * deterministic `?shot` entry uses {@link cameraFor} alone. The `?zoom=` knob exists so a human can
 * actually judge a decoded bob's pixels: a ~30px sprite is lost on a 960px canvas, so a verification
 * frame magnifies and re-centres.
 */

/**
 * Build the camera for a frame. At zoom 1 it keeps the historical pan (the iso strip projects to
 * negative screen-x, so the offset nudges it into view). At a higher zoom it centres on the centroid of
 * the settlers (the camera follows the people — they're the animated subjects a pixel check inspects),
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

/**
 * The camera that puts tile `(tileX, tileY)` at the viewport centre at `zoom` — the inverse of the iso
 * projection the renderer applies (`screen = world*scale + offset`, like {@link cameraFor}). Backs the
 * `?center=x,y` inspection knob (`entries/map.ts`): a decoded map's feature — a bridge, a coastline —
 * that the settler-centroid framing would never land on. Pure.
 */
export function cameraCenteredOnTile(
  tileX: number,
  tileY: number,
  zoom: number,
  width: number,
  height: number,
): Camera {
  const s = tileToScreen(tileX, tileY);
  return cameraCenteredOnWorld(s.x, s.y, zoom, width, height);
}

/**
 * The camera that puts world point `(worldX, worldY)` (projected px, pre-camera) at the viewport centre
 * at `zoom` — {@link cameraCenteredOnTile} without the tile→world projection, for callers that already
 * hold a world point (the minimap's click-to-jump). Pure.
 */
export function cameraCenteredOnWorld(
  worldX: number,
  worldY: number,
  zoom: number,
  width: number,
  height: number,
): Camera {
  return { offsetX: width / 2 - worldX * zoom, offsetY: height / 2 - worldY * zoom, scale: zoom };
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
