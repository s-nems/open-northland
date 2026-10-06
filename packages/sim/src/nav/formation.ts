import type { HalfCellNode } from './halfcell.js';

/** Nearest square rings in fixed order. Military rows skip alternate half-rows; clipped edges visit
 *  each eligible on-map node at most once, even when the whole target area is unavailable. */
export function formationNodes(
  target: HalfCellNode,
  count: number,
  width: number,
  height: number,
  blocked: (hx: number, hy: number) => boolean,
  rowSpacing: 1 | 2 = 1,
): HalfCellNode[] {
  const out: HalfCellNode[] = [];
  if (count <= 0 || width <= 0 || height <= 0) return out;
  const { hx, hy } = target;
  const take = (x: number, y: number): void => {
    if (out.length < count && !blocked(x, y)) out.push({ hx: x, hy: y });
  };
  const left = -hx,
    right = width - 1 - hx;
  const top = Math.ceil(-hy / rowSpacing),
    bottom = Math.floor((height - 1 - hy) / rowSpacing);
  const maxRadius = Math.max(-left, right, -top, bottom);
  if (left <= 0 && right >= 0 && top <= 0 && bottom >= 0) take(hx, hy);
  for (let radius = 1; out.length < count && radius <= maxRadius; radius++) {
    if (-radius >= top && -radius <= bottom)
      for (let dx = Math.max(-radius, left); dx <= Math.min(radius, right); dx++)
        take(hx + dx, hy - radius * rowSpacing);
    if (radius >= left && radius <= right)
      for (let dy = Math.max(-radius + 1, top); dy <= Math.min(radius, bottom); dy++)
        take(hx + radius, hy + dy * rowSpacing);
    if (radius >= top && radius <= bottom)
      for (let dx = Math.min(radius - 1, right); dx >= Math.max(-radius, left); dx--)
        take(hx + dx, hy + radius * rowSpacing);
    if (-radius >= left && -radius <= right)
      for (let dy = Math.min(radius - 1, bottom); dy >= Math.max(-radius + 1, top); dy--)
        take(hx - radius, hy + dy * rowSpacing);
  }
  return out;
}
