import { describe, expect, it } from 'vitest';
import { type AuthoredJoinRows, contentJoins } from '../../../src/game/world/index.js';

const BYZANTINE = 3;
const DRAGON = 42;
const SOLDIER_UNARMED = 31;
const SOLDIER_SPEAR_WOODEN = 32;
const SOLDIER_SWORD_SHORT = 34;
const SOLDIER_SWORD_LONG = 35;
const SOLDIER_SABER_SHORT = 36;
const SOLDIER_AXE_BIG = 39;
const HERO_SWORD_BJARNI = 44;
const HERO_AXE = 46;

const JOBS = [
  { typeId: SOLDIER_UNARMED, id: 'soldier_unarmed', name: 'soldier_unarmed' },
  { typeId: SOLDIER_SPEAR_WOODEN, id: 'soldier_spear_wooden', name: 'soldier_spear_wooden' },
  { typeId: SOLDIER_SWORD_SHORT, id: 'soldier_sword_short', name: 'soldier_sword_short' },
  { typeId: SOLDIER_SWORD_LONG, id: 'soldier_sword_long', name: 'soldier_sword_long' },
  { typeId: HERO_SWORD_BJARNI, id: 'hero_sword_bjarni', name: 'hero_sword_BJARNI' },
];

/** A pack without the retired trades and with the dragon tribe. */
const PACK: AuthoredJoinRows = {
  jobs: JOBS,
  tribes: [
    { typeId: BYZANTINE, id: 'byzantine' },
    { typeId: DRAGON, id: 'dragon' },
  ],
};

/** A pack that still carries the retired trades and has no dragon tribe. */
const OLD_PACK: AuthoredJoinRows = {
  jobs: [
    ...JOBS,
    { typeId: SOLDIER_SABER_SHORT, id: 'soldier_saber_short', name: 'soldier_saber_short' },
    { typeId: HERO_AXE, id: 'hero_axe', name: 'hero_axe_???' },
  ],
  tribes: [{ typeId: BYZANTINE, id: 'byzantine' }],
};

describe('contentJoins legacy units', () => {
  it('places a Byzantine wooden spearman as the dragon, and leaves him be in a pack without one', () => {
    expect(contentJoins(PACK).unit(BYZANTINE, SOLDIER_SPEAR_WOODEN)).toEqual({
      tribe: DRAGON,
      job: SOLDIER_UNARMED,
    });
    expect(contentJoins(PACK).unit(BYZANTINE, SOLDIER_SWORD_SHORT)).toEqual({
      tribe: BYZANTINE,
      job: SOLDIER_SWORD_SHORT,
    });
    expect(contentJoins(OLD_PACK).unit(BYZANTINE, SOLDIER_SPEAR_WOODEN)).toEqual({
      tribe: BYZANTINE,
      job: SOLDIER_SPEAR_WOODEN,
    });
  });

  it('joins a retired trade by name in any spelling and by id as its replacement', () => {
    const joins = contentJoins(PACK);
    expect(joins.job('SOLDIER_SABER_SHORT')).toBe(SOLDIER_SWORD_SHORT);
    expect(joins.job('soldier_axe_big')).toBe(SOLDIER_SWORD_LONG);
    expect(joins.job('hero_axe_???')).toBe(HERO_SWORD_BJARNI);
    expect(joins.jobId(SOLDIER_AXE_BIG)).toBe(SOLDIER_SWORD_LONG);
    expect(joins.jobId(HERO_AXE)).toBe(HERO_SWORD_BJARNI);
    expect(joins.jobId(SOLDIER_SPEAR_WOODEN)).toBe(SOLDIER_SPEAR_WOODEN);
  });

  it('keeps a retired trade the pack still defines', () => {
    const joins = contentJoins(OLD_PACK);
    expect(joins.job('soldier_saber_short')).toBe(SOLDIER_SABER_SHORT);
    expect(joins.job('hero_axe_???')).toBe(HERO_AXE);
    expect(joins.jobId(SOLDIER_SABER_SHORT)).toBe(SOLDIER_SABER_SHORT);
  });
});
