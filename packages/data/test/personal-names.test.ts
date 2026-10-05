import { describe, expect, it } from 'vitest';
import { IR_VERSION, PERSONAL_NAMES, PersonalNamePool, parseContentSet } from '../src/index.js';

const pool = { id: 'example-male', tribe: 1, sex: 'male', names: ['Erik', 'Leif'] };
const raw = {
  manifest: { version: IR_VERSION, generatedFrom: { mod: 'synthetic' } },
  goods: [],
  jobs: [],
  buildings: [],
  tribes: [{ typeId: 1, id: 'example' }],
};

describe('personal name content', () => {
  it.each(
    [[], ['Erik', 'erik'], [' Erik'], [''], ['Two Words'], ['E\u0000rik'], ['E\u200Brik'], ['A\u0301da']].map(
      (names) => [names],
    ),
  )('rejects an invalid name list: %j', (names) => {
    expect(() => PersonalNamePool.parse({ ...pool, names })).toThrow();
  });
  it('ships one male/female pair per civilization and a neutral pool per creature tribe', () => {
    const tribes = [1, 2, 3, 4, 5, 6, 7].map((typeId) => ({ typeId, id: `tribe-${typeId}` }));
    const set = parseContentSet({ ...raw, tribes, personalNames: PERSONAL_NAMES });
    expect(set.personalNames).toHaveLength(12);
    for (const tribe of [1, 2, 3, 4, 7]) {
      expect(
        set.personalNames
          .filter((pool) => pool.tribe === tribe)
          .map((pool) => pool.sex)
          .sort(),
      ).toEqual(['female', 'male']);
    }
    for (const tribe of [5, 6])
      expect(set.personalNames.find((pool) => pool.tribe === tribe)?.names).toHaveLength(256);
  });

  it('validates pool ids and tribe bindings at the content boundary', () => {
    expect(parseContentSet({ ...raw, personalNames: [pool] }).personalNames).toEqual([pool]);
    expect(() => parseContentSet({ ...raw, personalNames: [pool, pool] })).toThrow(/duplicate/);
    expect(() => parseContentSet({ ...raw, personalNames: [{ ...pool, tribe: 99 }] })).toThrow(
      /unknown tribe/,
    );
    expect(() => parseContentSet({ ...raw, personalNames: [pool, { ...pool, id: 'other' }] })).toThrow(
      /binding/,
    );
  });
});
