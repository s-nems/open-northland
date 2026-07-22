/**
 * The screen-space rect, point-in-rect test, and client→canvas point mapping every HUD layout/hit-test
 * module shares (tool panel, building menu, action ring, pop-up windows). Pure — no Pixi, no DOM — so
 * the layouts stay headlessly unit-testable. Rects are half-open on both axes (`[x, x+w) × [y, y+h)`),
 * so adjacent rects never double-claim a boundary pixel.
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

/** A CSS-px → canvas-px scale: per-axis factors plus the canvas origin in CSS px. The shape the
 *  camera's `screenScale` returns; kept here (not in `view/`) so `hud/` hit-tests can apply the same
 *  mapping without importing the view layer. */
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
