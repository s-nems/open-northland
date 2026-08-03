import type { ContentSet } from '@open-northland/data';

/** The good types backing a weapon or piece of armor (their `goodType`, when present). */
export function militaryGoodTypes(content: ContentSet): ReadonlySet<number> {
  const goods = new Set<number>();
  for (const w of content.weapons) if (w.goodType !== undefined) goods.add(w.goodType);
  for (const a of content.armor) if (a.goodType !== undefined) goods.add(a.goodType);
  return goods;
}
