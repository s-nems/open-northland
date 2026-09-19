/**
 * A screen-space rect, half-open on both axes (`[x, x+w) × [y, y+h)`), so adjacent rects never
 * double-claim a boundary pixel.
 */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** True when screen point `(x, y)` lies inside `r` (half-open bounds). */
export function contains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/** `r` shrunk by `by` on every side. */
export function insetRect(r: Rect, by: number): Rect {
  return { x: r.x + by, y: r.y + by, w: Math.max(0, r.w - 2 * by), h: Math.max(0, r.h - 2 * by) };
}

/** The overlap of two rects, or null when they share no area. */
export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** A CSS-px → canvas-px scale: per-axis factors plus the canvas origin in CSS px. Kept here so `hud/`
 *  hit-tests can apply the camera's mapping without importing the view layer. */
export interface ScreenScale {
  readonly sx: number;
  readonly sy: number;
  readonly rect: { readonly left: number; readonly top: number };
}

/** Map a client (CSS) point to canvas (screen) px: subtract the canvas origin in CSS px, then scale. */
export function clientToCanvas(
  scale: ScreenScale,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  return { x: (clientX - scale.rect.left) * scale.sx, y: (clientY - scale.rect.top) * scale.sy };
}
