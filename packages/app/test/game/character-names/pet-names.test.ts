import { describe, expect, it } from 'vitest';
import { petNamesOf, SETTLER_NAME_MAX_CHARS } from '../../../src/game/character-names/pet-names.js';

const harald = { entity: 7, pool: 'viking-male', raw: 'Harald' };

describe('the names the player gives', () => {
  it('keeps a trimmed name and takes it back with a blank one', () => {
    const names = petNamesOf();
    expect(names.set(harald, '  Ada  ')).toBe('named');
    expect(names.get(harald)).toBe('Ada');
    expect(names.set(harald, '   ')).toBe('cleared');
    expect(names.get(harald)).toBeUndefined();
  });

  it('refuses an over-long name or a control character and keeps the name already given', () => {
    const names = petNamesOf();
    names.set(harald, 'Ada');
    expect(names.set(harald, 'x'.repeat(SETTLER_NAME_MAX_CHARS + 1))).toBe('refused');
    expect(names.set(harald, 'A\u0007da')).toBe('refused');
    expect(names.get(harald)).toBe('Ada');
    // The limit counts code points, so a name of astral characters fits at the same length.
    expect(names.set(harald, '🚩'.repeat(SETTLER_NAME_MAX_CHARS))).toBe('named');
  });

  it('gives a name only to the settler it was given to, not a later one under the same entity id', () => {
    const names = petNamesOf([{ ...harald, name: 'Ada' }]);
    expect(names.get(harald)).toBe('Ada');
    expect(names.get({ ...harald, raw: 'Bjarni' })).toBeUndefined();
    expect(names.get({ ...harald, pool: 'frank-male' })).toBeUndefined();
  });

  it('starts from the kept names, dropping one the rules refuse', () => {
    const bjarni = { entity: 8, pool: 'viking-male', raw: 'Bjarni' };
    const names = petNamesOf([
      { ...harald, name: 'Ada' },
      { ...bjarni, name: 'x'.repeat(SETTLER_NAME_MAX_CHARS + 1) },
    ]);
    expect(names.records()).toEqual([{ ...harald, name: 'Ada' }]);
  });
});
