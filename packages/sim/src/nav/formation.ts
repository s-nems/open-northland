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

/** A point to pair: `key` breaks ties so input order never decides a pairing. */
export interface SpacePoint<K extends number = number> {
  readonly key: K;
  readonly x: number;
  readonly y: number;
}

/**
 * Pair the members of `from` with as many points of `to` by splitting both layouts on the same axis, the
 * wider one, and pairing the corresponding halves: neighbours stay neighbours and a translated layout
 * keeps every member's place, in O(n log² n). Returns `to` keys by `from` key; `to` must hold at least
 * as many points as `from`, and its surplus is left out.
 */
export function pairBySpace<K extends number>(
  from: readonly SpacePoint<K>[],
  to: readonly SpacePoint[],
): Map<K, number> {
  const paired = new Map<K, number>();
  const span = (points: readonly SpacePoint[], axis: 'x' | 'y'): number => {
    let low = Number.POSITIVE_INFINITY,
      high = Number.NEGATIVE_INFINITY;
    for (const point of points) {
      low = Math.min(low, point[axis]);
      high = Math.max(high, point[axis]);
    }
    return high - low;
  };
  const pair = (a: SpacePoint<K>[], b: SpacePoint[]): void => {
    if (a.length === 1) {
      const member = a[0],
        place = b[0];
      if (member !== undefined && place !== undefined) paired.set(member.key, place.key);
      return;
    }
    const axis = span(a, 'x') + span(b, 'x') >= span(a, 'y') + span(b, 'y') ? 'x' : 'y';
    const other = axis === 'x' ? 'y' : 'x';
    const compare = (left: SpacePoint, right: SpacePoint): number =>
      left[axis] - right[axis] || left[other] - right[other] || left.key - right.key;
    a.sort(compare);
    b.sort(compare);
    const middle = Math.floor(a.length / 2);
    pair(a.slice(0, middle), b.slice(0, middle));
    pair(a.slice(middle), b.slice(middle));
  };
  if (from.length > 0) pair([...from], [...to].slice(0, from.length));
  return paired;
}
