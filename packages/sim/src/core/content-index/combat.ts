import type { ContentSet } from '@open-northland/data';

/** The set of good types backing a weapon or piece of armor (their `goodType`, when present) — the forged
 *  military items (see {@link import('../content-index.js').ContentIndex.militaryGoods}). */
export function militaryGoodTypes(content: ContentSet): ReadonlySet<number> {
  const goods = new Set<number>();
  for (const w of content.weapons) if (w.goodType !== undefined) goods.add(w.goodType);
  for (const a of content.armor) if (a.goodType !== undefined) goods.add(a.goodType);
  return goods;
}
