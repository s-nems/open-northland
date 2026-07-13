import { parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { armorByClass, armorClassOf } from '../../../src/systems/index.js';
import { armor, armorContent, SCAFFOLD } from './support.js';

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
