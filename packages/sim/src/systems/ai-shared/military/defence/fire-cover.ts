import type { Shooter } from './threat.js';

/**
 * Which nodes of the box `|x - cx| <= halfWidth`, `|y - cy| <= halfHeight` stand within some shooter's
 * reach plus `extra` map points, by the same measure as `hexDistanceBetween(s.x, s.y, x, y)`. One row
 * interval per shooter and row, summed per row, so a fan search tests each node once instead of
 * against every shooter. Read it through {@link FireCover.covers}.
 */
export interface FireCover {
  /** Whether `(x, y)` is covered, or null outside the box. */
  covers(x: number, y: number): boolean | null;
}

export function fireCover(
  shooters: readonly Shooter[],
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number,
  extra: number,
): FireCover {
  const left = cx - halfWidth;
  const top = cy - halfHeight;
  const width = 2 * halfWidth + 1;
  const height = 2 * halfHeight + 1;
  const covered = new Uint8Array(width * height);
  const runs = new Int32Array(width + 1);
  for (let row = 0; row < height; row++) {
    const y = top + row;
    runs.fill(0);
    let any = false;
    for (const s of shooters) {
      const rows = Math.abs(y - s.y);
      const limit = s.reach + extra;
      if (rows > limit) continue;
      // Inverts `hexDistanceBetween`, `rows + max(0, columns - rows / 2)`: an odd row offset frees one
      // more column toward the right on an even target row, toward the left on an odd one.
      const columns = limit - rows + (rows >> 1);
      const odd = (rows & 1) !== 0;
      const evenRow = (y & 1) === 0;
      const from = Math.max(s.x - columns - (odd && !evenRow ? 1 : 0), left) - left;
      const to = Math.min(s.x + columns + (odd && evenRow ? 1 : 0), left + width - 1) - left;
      if (from > to) continue;
      runs[from] = (runs[from] ?? 0) + 1;
      runs[to + 1] = (runs[to + 1] ?? 0) - 1;
      any = true;
    }
    if (!any) continue;
    let depth = 0;
    for (let col = 0; col < width; col++) {
      depth += runs[col] ?? 0;
      if (depth > 0) covered[row * width + col] = 1;
    }
  }
  return {
    covers(x, y) {
      const col = x - left;
      const row = y - top;
      if (col < 0 || col >= width || row < 0 || row >= height) return null;
      return covered[row * width + col] === 1;
    },
  };
}
