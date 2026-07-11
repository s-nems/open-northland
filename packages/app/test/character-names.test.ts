import { describe, expect, it } from 'vitest';
import { VIKING } from '../src/catalog/buildings.js';
import { characterName, settlerSex } from '../src/game/character-names.js';

// Jobs whose sex is fixed by the body they draw (mirrors `content/settler-gfx.ts`): baby_female 1,
// baby_male 2, girl 3, boy 4, adult woman 5. Every other job draws the male body.
const BABY_FEMALE = 1;
const BABY_MALE = 2;
const GIRL = 3;
const BOY = 4;
const WOMAN = 5;
const CIVILIAN = 6;

const UNKNOWN_TRIBE = 999;

describe('settlerSex', () => {
  it('sexes young settlers by their age-class job', () => {
    expect(settlerSex(BABY_FEMALE, true)).toBe('female');
    expect(settlerSex(GIRL, true)).toBe('female');
    expect(settlerSex(BABY_MALE, true)).toBe('male');
    expect(settlerSex(BOY, true)).toBe('male');
  });

  it('sexes an adult female only for the woman job, every other adult male', () => {
    expect(settlerSex(WOMAN, false)).toBe('female');
    expect(settlerSex(CIVILIAN, false)).toBe('male');
    expect(settlerSex(null, false)).toBe('male');
    // The child job ids only mean "female/child" for a young (Age-carrying) settler; an adult carrying the
    // same raw id is male, exactly as the render body-join disambiguates by the `Age` component.
    expect(settlerSex(GIRL, false)).toBe('male');
  });
});

describe('characterName', () => {
  it('is stable and deterministic for a given entity', () => {
    const first = characterName(VIKING, CIVILIAN, false, 7);
    expect(characterName(VIKING, CIVILIAN, false, 7)).toBe(first);
    expect(first).not.toBe('');
  });

  it('is a first name plus a sex-matched Norse patronymic', () => {
    const man = characterName(VIKING, CIVILIAN, false, 3);
    const woman = characterName(VIKING, WOMAN, false, 3);
    // "<First> <Father>sson" / "<First> <Father>sdóttir" — two words, patronymic suffix by sex.
    expect(man.split(' ')).toHaveLength(2);
    expect(man.endsWith('sson')).toBe(true);
    expect(woman.endsWith('sdóttir')).toBe(true);
  });

  it('gives a faction- and sex-appropriate name that matches the drawn body', () => {
    // A viking woman draws from the female pool, a viking man from the male pool — the two produce
    // disjoint names (differing patronymic suffix guarantees it), so a woman never gets a man's name.
    const femaleNames = new Set(
      Array.from({ length: 40 }, (_, id) => characterName(VIKING, WOMAN, false, id)),
    );
    const maleNames = new Set(
      Array.from({ length: 40 }, (_, id) => characterName(VIKING, CIVILIAN, false, id)),
    );
    for (const name of femaleNames) expect(maleNames.has(name)).toBe(false);
  });

  it('names an unknown tribe from the viking fallback pool until it has its own', () => {
    const viaFallback = characterName(UNKNOWN_TRIBE, CIVILIAN, false, 3);
    expect(viaFallback).toBe(characterName(VIKING, CIVILIAN, false, 3));
  });

  it('spreads surnames across a batch of clustered ids (no shared family name by accident)', () => {
    // Regression: settlers spawned together get consecutive entity ids. The surname must NOT be constant
    // across such a batch (the old "everyone Ragnarsson / every soldier Bjørnsson" bug) — the coprime grid
    // scatter gives each a well-spread surname. 50 consecutive ids must yield many distinct surnames.
    const surnames = new Set(
      Array.from({ length: 50 }, (_, id) => characterName(VIKING, CIVILIAN, false, id).split(' ')[1]),
    );
    expect(surnames.size).toBeGreaterThan(30);
  });

  it('inherits a husband/father surname through the family seam', () => {
    const husbandId = 12;
    const husbandSurname = characterName(VIKING, CIVILIAN, false, husbandId).split(' ')[1];
    // A wife (female body) married to him takes his surname verbatim — the male "…sson", not her own
    // "…sdóttir" — and keeps her own first name.
    const wife = characterName(VIKING, WOMAN, false, 40, husbandId);
    expect(wife.endsWith('sson')).toBe(true);
    expect(wife.split(' ')[1]).toBe(husbandSurname);
    // A child likewise carries the father's surname.
    const child = characterName(VIKING, BOY, true, 55, husbandId);
    expect(child.split(' ')[1]).toBe(husbandSurname);
    // Without the seam she keeps her own maiden patronymic, which differs from the husband's surname.
    const maiden = characterName(VIKING, WOMAN, false, 40);
    expect(maiden.split(' ')[1]).not.toBe(husbandSurname);
  });

  it('very rarely repeats — a large settlement of consecutive ids stays unique', () => {
    // The first-name × father-name cross product is thousands wide, so far more settlers than any real
    // settlement get a unique name. 1500 consecutive ids (either sex) must all differ.
    const count = 1500;
    const men = new Set(Array.from({ length: count }, (_, id) => characterName(VIKING, CIVILIAN, false, id)));
    const women = new Set(Array.from({ length: count }, (_, id) => characterName(VIKING, WOMAN, false, id)));
    expect(men.size).toBe(count);
    expect(women.size).toBe(count);
  });
});
