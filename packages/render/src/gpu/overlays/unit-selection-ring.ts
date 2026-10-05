import type { Graphics } from 'pixi.js';
import type { SelectionEllipse } from '../../data/sprites/atlas.js';

// Artistic choice: an unfilled ivory ellipse, with a stronger front and a dark contrasting edge.
const IVORY = 0xf2e8c9;
const EDGE = 0x14211b;

/** Geometry stays in world pixels; line weights and focus marks stay in logical screen pixels. */
export function drawUnitSelectionRing(
  g: Graphics,
  ellipse: SelectionEllipse,
  zoom: number,
  focus: boolean,
  ringColor = IVORY,
): void {
  const { cx, cy, rx, ry } = ellipse;
  if (focus) {
    for (const side of [-1, 1]) {
      const x = cx + side * (rx + 4 / zoom);
      for (const [width, color] of [
        [3, EDGE],
        [1.2, ringColor],
      ] as const) {
        g.moveTo(x + (side * 2) / zoom, cy - 3 / zoom)
          .lineTo(x, cy)
          .lineTo(x + (side * 2) / zoom, cy + 3 / zoom)
          .stroke({ width: width / zoom, color, cap: 'round', join: 'round' });
      }
    }
    return;
  }
  // Clockwise from left to right is the rear half; right to left is the nearer half.
  for (const [side, width, color, alpha] of [
    [-1, 2.6, EDGE, 0.55],
    [1, 3.25, EDGE, 0.8],
    [-1, 1.1, ringColor, 0.55],
    [1, 1.6, ringColor, 1],
  ] as const) {
    g.moveTo(cx + side * rx, cy)
      .arcToSvg(rx, ry, 0, 0, 1, cx - side * rx, cy)
      .stroke({ width: width / zoom, color, alpha, cap: 'butt' });
  }
}
