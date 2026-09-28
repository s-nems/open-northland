import type { Rect } from '../geometry.js';

/** Each HUD plane owns its live minimap footprint, in design px. */
const reserves = new WeakMap<HTMLElement, Rect>();

export function setMinimapReserve(plane: HTMLElement, panel: Rect | null, scale: number): void {
  if (panel === null) reserves.delete(plane);
  else
    reserves.set(plane, { x: panel.x / scale, y: panel.y / scale, w: panel.w / scale, h: panel.h / scale });
}

export function minimapReserve(plane: HTMLElement): Rect | null {
  return reserves.get(plane) ?? null;
}
