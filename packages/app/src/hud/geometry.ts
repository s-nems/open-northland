/**
 * The ONE screen-space rect + point-in-rect test every HUD layout/hit-test module shares (tool panel,
 * building menu, action ring, pop-up windows). Pure — no Pixi, no DOM — so the layouts stay headlessly
 * unit-testable. Half-open on both axes (`[x, x+w) × [y, y+h)`), so adjacent rects never double-claim
 * a boundary pixel.
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
