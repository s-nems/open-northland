import type { GfxPattern } from '@open-northland/data';
import type { GroundPattern } from '@open-northland/render';

export const MOUNTAIN_WIDTH = 1088;
export const MOUNTAIN_HEIGHT = 836;
export const MOUNTAIN_GUTTER = 136;

/** Owned mountain block names describe overlapping pages; the review map repeats after 8 columns and 11 rows. */
export function ownMountainPattern(row: GfxPattern, pageKey: string): GroundPattern | undefined {
  const match = /^block mountain ([0-2])([0-2]) (0[0-4]) (0[0-3])$/.exec(row.editName ?? '');
  if (match) {
    const localRow = Number(match[4]);
    const localCol = Number(match[3]);
    const firstCol = Math.ceil(localRow / 2);
    if (localCol < firstCol || localCol >= firstCol + 3) return undefined;
    const x = (Number(match[1]) * 3 + localCol - localRow / 2) * 136 + MOUNTAIN_GUTTER;
    const y = (Number(match[2]) * 4 + localRow) * 76 + MOUNTAIN_GUTTER;
    return {
      pageKey,
      coordsA: [x, y, x + 68, y + 76, x - 68, y + 76],
      coordsB: [x, y, x + 136, y, x + 68, y + 76],
    };
  }
  const standalone = /^mountain 0([1-4])$/.exec(row.editName ?? '');
  if (!standalone) return undefined;
  const x = (Number(standalone[1]) - 1) * 272 + 68 + MOUNTAIN_GUTTER;
  const y = 304 + MOUNTAIN_GUTTER;
  return {
    pageKey,
    coordsA: [x, y, x + 68, y + 76, x - 68, y + 76],
    coordsB: [x, y, x + 136, y, x + 68, y + 76],
  };
}
