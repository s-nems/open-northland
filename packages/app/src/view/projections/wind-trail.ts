import type { ContentSet } from '@open-northland/data';

/** The goods that shorten their carrier's step: the walker carrying a live one trails wind. */
export function windTrailGoods(goods: ContentSet['goods']): ReadonlySet<number> {
  const fast = new Set<number>();
  for (const good of goods) if (good.equip?.walkStepTicksSaved !== undefined) fast.add(good.typeId);
  return fast;
}
