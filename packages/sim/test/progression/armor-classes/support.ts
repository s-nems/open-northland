import { type ArmorType, type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';

/** Resolve an armor record by its `id` (throws if absent — a test-fixture programmer error). */
export function armor(content: ContentSet, id: string): ArmorType {
  const found = content.armor.find((a) => a.id === id);
  if (found === undefined) throw new Error(`fixture has no armor "${id}"`);
  return found;
}

/** The minimal non-armor scaffolding `parseContentSet` requires (goods/jobs/buildings). */
export const SCAFFOLD = {
  manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
  goods: [{ typeId: 0, id: 'none' }],
  jobs: [{ typeId: 0, id: 'idle' }],
  buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' as const }],
};

/**
 * The armor-classification read views — `armorClassOf` (a record's coarse `mainType` class) and
 * `armorByClass` (the table grouped by that class) — the armor-side twins of `weaponClassOf`/
 * `weaponsByClass`. `mainType` is a multi-valued class enum every armor record carries (`1` =
 * light/cloth+leather, `2` = heavy/chain+plate in the base data; the real `armortypes.ini` ships four
 * records with `mainType` `{1,1,2,2}`), so the natural view is a *grouping*, not a filter — and several
 * records share a class. Classified *by the data alone*; a pure read over content, no mechanic added.
 *
 * The fixture mirrors the real four-record shape: two light (cloth, leather → class 1) and two heavy
 * (chain, plate → class 2), declared out of class order to prove the grouping keeps `content.armor`
 * source order within each bucket rather than re-sorting. Each record also carries its `materialType`
 * (the FINER tier axis — cloth=1/leather=2/chain=3/plate=4, all distinct), so the same fixture exercises
 * both partitions: `mainType` collapses the four records into two buckets, `materialType` into four.
 */
export function armorContent(): ContentSet {
  return parseContentSet({
    ...SCAFFOLD,
    armor: [
      { typeId: 1, id: 'cloth', mainType: 1, materialType: 1 }, // light, tier 1
      { typeId: 3, id: 'chain', mainType: 2, materialType: 3 }, // heavy (declared before the other light row), tier 3
      { typeId: 2, id: 'leather', mainType: 1, materialType: 2 }, // light, tier 2
      { typeId: 4, id: 'plate', mainType: 2, materialType: 4 }, // heavy, tier 4
    ],
  });
}
