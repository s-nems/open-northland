import { type Camera, type DrawItem, tileToScreen } from '@open-northland/render';

/**
 * Frames `screen = world*scale + offset`. Zoom 1 keeps the fixed pan that pulls the negative-screen-x iso
 * strip into view; a higher zoom centres on the settler centroid instead.
 */
export function cameraFor(scene: readonly DrawItem[], zoom: number, width: number, height: number): Camera {
  if (zoom === 1) return { offsetX: width / 2, offsetY: height / 3 };
  const focus = centroid(scene, (k) => k === 'settler') ?? centroid(scene, (k) => k !== 'tile') ?? null;
  const focusX = focus?.x ?? 0;
  const focusY = focus?.y ?? 0;
  return { offsetX: width / 2 - focusX * zoom, offsetY: height / 2 - focusY * zoom, scale: zoom };
}

/** The camera that puts tile `(tileX, tileY)` at the viewport centre at `zoom`. */
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

/** The camera that puts world point `(worldX, worldY)`, in projected pre-camera px, at the viewport centre. */
export function cameraCenteredOnWorld(
  worldX: number,
  worldY: number,
  zoom: number,
  width: number,
  height: number,
): Camera {
  return { offsetX: width / 2 - worldX * zoom, offsetY: height / 2 - worldY * zoom, scale: zoom };
}

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
