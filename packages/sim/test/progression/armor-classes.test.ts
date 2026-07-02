import { type ArmorType, type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { describe, expect, it } from 'vitest';
import {
  armorByClass,
  armorByMaterial,
  armorClassOf,
  armorMaterialOf,
  armorWeightOf,
} from '../../src/systems/index.js';

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
 * source order within each bucket rather than re-sorting. Each record also carries its `materialType`
 * (the FINER tier axis — cloth=1/leather=2/chain=3/plate=4, all distinct), so the same fixture exercises
 * both partitions: `mainType` collapses the four records into two buckets, `materialType` into four.
 */
function armorContent(): ContentSet {
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

describe('armorMaterialOf', () => {
  it('returns the finer material tier (its materialType) for each record', () => {
    const content = armorContent();
    expect(armorMaterialOf(armor(content, 'cloth'))).toBe(1);
    expect(armorMaterialOf(armor(content, 'leather'))).toBe(2);
    expect(armorMaterialOf(armor(content, 'chain'))).toBe(3);
    expect(armorMaterialOf(armor(content, 'plate'))).toBe(4);
  });

  it('is a finer axis than armorClassOf: distinct tiers can share one coarse class', () => {
    const content = armorContent();
    // cloth and leather share mainType 1 (light) but carry different material tiers
    expect(armorClassOf(armor(content, 'cloth'))).toBe(armorClassOf(armor(content, 'leather')));
    expect(armorMaterialOf(armor(content, 'cloth'))).not.toBe(armorMaterialOf(armor(content, 'leather')));
  });

  it('is undefined for a malformed record carrying no materialType', () => {
    const content = parseContentSet({
      ...SCAFFOLD,
      armor: [{ typeId: 1, id: 'no_tier' }],
    });
    expect(armorMaterialOf(armor(content, 'no_tier'))).toBeUndefined();
  });
});

describe('armorWeightOf', () => {
  it('returns the encumbrance weight (its weight field) for each record', () => {
    // the real armortypes.ini weights: cloth 1, leather 0, chain 3, plate 3
    const content = parseContentSet({
      ...SCAFFOLD,
      armor: [
        { typeId: 1, id: 'cloth', materialType: 1, weight: 1 },
        { typeId: 2, id: 'leather', materialType: 2, weight: 0 },
        { typeId: 3, id: 'chain', materialType: 3, weight: 3 },
        { typeId: 4, id: 'plate', materialType: 4, weight: 3 },
      ],
    });
    expect(armorWeightOf(armor(content, 'cloth'))).toBe(1);
    expect(armorWeightOf(armor(content, 'leather'))).toBe(0);
    expect(armorWeightOf(armor(content, 'chain'))).toBe(3);
    expect(armorWeightOf(armor(content, 'plate'))).toBe(3);
  });

  it('does not track the material tier monotonically (weight is its own field)', () => {
    // leather (tier 2) weighs 0 while cloth (tier 1) weighs 1 — a finer-tier record is the lighter one
    const content = parseContentSet({
      ...SCAFFOLD,
      armor: [
        { typeId: 1, id: 'cloth', materialType: 1, weight: 1 },
        { typeId: 2, id: 'leather', materialType: 2, weight: 0 },
      ],
    });
    const cloth = armor(content, 'cloth');
    const leather = armor(content, 'leather');
    expect(armorMaterialOf(leather)).toBeGreaterThan(armorMaterialOf(cloth) ?? 0);
    expect(armorWeightOf(leather)).toBeLessThan(armorWeightOf(cloth)); // weight not derivable from tier
  });

  it('defaults to 0 for a record with no weight (the schema default, never undefined)', () => {
    // the shared armorContent() fixture declares no weight on any record
    const a = armor(armorContent(), 'cloth');
    expect(armorWeightOf(a)).toBe(0);
    expect(armorWeightOf(a)).not.toBeUndefined(); // a quantity, not a class enum — always a number
  });
});

describe('armorByMaterial', () => {
  it('partitions the armor by material tier — finer than armorByClass (four buckets, not two)', () => {
    const byMaterial = armorByMaterial(armorContent());
    // four distinct tiers among the four records, whereas armorByClass yields only two
    expect([...byMaterial.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(byMaterial.get(1)?.map((a) => a.id)).toEqual(['cloth']);
    expect(byMaterial.get(2)?.map((a) => a.id)).toEqual(['leather']);
    expect(byMaterial.get(3)?.map((a) => a.id)).toEqual(['chain']);
    expect(byMaterial.get(4)?.map((a) => a.id)).toEqual(['plate']);
  });

  it('groups multiple records sharing a tier into one bucket, preserving source order', () => {
    const content = parseContentSet({
      ...SCAFFOLD,
      // two tier-2 records (leather_a before leather_b) plus a tier-1 record between them
      armor: [
        { typeId: 2, id: 'leather_a', materialType: 2 },
        { typeId: 1, id: 'cloth', materialType: 1 },
        { typeId: 5, id: 'leather_b', materialType: 2 },
      ],
    });
    const byMaterial = armorByMaterial(content);
    // both leathers land in bucket 2, leather_a before leather_b (content.armor order)
    expect(byMaterial.get(2)?.map((a) => a.id)).toEqual(['leather_a', 'leather_b']);
    expect(byMaterial.get(1)?.map((a) => a.id)).toEqual(['cloth']);
  });

  it('omits a record with no materialType (no undefined bucket)', () => {
    const content = parseContentSet({
      ...SCAFFOLD,
      armor: [
        { typeId: 1, id: 'cloth', materialType: 1 },
        { typeId: 2, id: 'no_tier' }, // no materialType — dropped, not bucketed under undefined
      ],
    });
    const byMaterial = armorByMaterial(content);
    expect([...byMaterial.keys()]).toEqual([1]);
    expect(byMaterial.get(1)?.map((a) => a.id)).toEqual(['cloth']);
  });

  it('is empty for content with no armor (parseContentSet defaults armor to [])', () => {
    expect(armorByMaterial(parseContentSet({ ...SCAFFOLD })).size).toBe(0);
  });

  it('is byte-stable call-to-call (a pure function of content)', () => {
    const content = armorContent();
    expect(armorByMaterial(content)).toEqual(armorByMaterial(content));
  });
});
