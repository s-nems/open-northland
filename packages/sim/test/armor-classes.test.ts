import { type ArmorType, type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { describe, expect, it } from 'vitest';
import { armorByClass, armorClassOf } from '../src/systems/index.js';

/** Resolve an armor record by its `id` (throws if absent — a test-fixture programmer error). */
function armor(content: ContentSet, id: string): ArmorType {
  const found = content.armor.find((a) => a.id === id);
  if (found === undefined) throw new Error(`fixture has no armor "${id}"`);
  return found;
}

/** The minimal non-armor scaffolding `parseContentSet` requires (goods/jobs/buildings). */
const SCAFFOLD = {
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
 * source order within each bucket rather than re-sorting.
 */
function armorContent(): ContentSet {
  return parseContentSet({
    ...SCAFFOLD,
    armor: [
      { typeId: 1, id: 'cloth', mainType: 1 }, // light
      { typeId: 3, id: 'chain', mainType: 2 }, // heavy (declared before the other light row)
      { typeId: 2, id: 'leather', mainType: 1 }, // light
      { typeId: 4, id: 'plate', mainType: 2 }, // heavy
    ],
  });
}

describe('armorClassOf', () => {
  it('returns the coarse armor class (its mainType) for each record', () => {
    const content = armorContent();
    expect(armorClassOf(armor(content, 'cloth'))).toBe(1);
    expect(armorClassOf(armor(content, 'leather'))).toBe(1);
    expect(armorClassOf(armor(content, 'chain'))).toBe(2);
    expect(armorClassOf(armor(content, 'plate'))).toBe(2);
  });

  it('is undefined for a malformed record carrying no mainType', () => {
    const content = parseContentSet({
      ...SCAFFOLD,
      armor: [{ typeId: 1, id: 'no_class' }],
    });
    expect(armorClassOf(armor(content, 'no_class'))).toBeUndefined();
  });
});

describe('armorByClass', () => {
  it('partitions the armor by class, grouping records that share one in source order', () => {
    const byClass = armorByClass(armorContent());
    // two classes among the four records: light=1 (cloth, leather), heavy=2 (chain, plate)
    expect([...byClass.keys()].sort((a, b) => a - b)).toEqual([1, 2]);
    // declared order is cloth, chain, leather, plate — so bucket 1 keeps cloth before leather,
    // bucket 2 keeps chain before plate (content.armor order, not re-sorted by typeId)
    expect(byClass.get(1)?.map((a) => a.id)).toEqual(['cloth', 'leather']);
    expect(byClass.get(2)?.map((a) => a.id)).toEqual(['chain', 'plate']);
  });

  it('omits a record with no mainType (no undefined bucket)', () => {
    const content = parseContentSet({
      ...SCAFFOLD,
      armor: [
        { typeId: 1, id: 'cloth', mainType: 1 },
        { typeId: 2, id: 'no_class' }, // no mainType — dropped, not bucketed under undefined
      ],
    });
    const byClass = armorByClass(content);
    expect([...byClass.keys()]).toEqual([1]);
    expect(byClass.get(1)?.map((a) => a.id)).toEqual(['cloth']);
  });

  it('is empty for content with no armor (parseContentSet defaults armor to [])', () => {
    expect(armorByClass(parseContentSet({ ...SCAFFOLD })).size).toBe(0);
  });

  it('is byte-stable call-to-call (a pure function of content)', () => {
    const content = armorContent();
    expect(armorByClass(content)).toEqual(armorByClass(content));
  });
});
