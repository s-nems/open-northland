import { describe, expect, it } from 'vitest';
import { VIKING } from '../src/catalog/buildings.js';
import {
  JOB_BABY_FEMALE,
  JOB_BABY_MALE,
  JOB_CHILD_FEMALE,
  JOB_CHILD_MALE,
  JOB_CIVILIST,
  JOB_WOMAN,
} from '../src/catalog/jobs.js';
import { characterName, settlerSex } from '../src/game/character-names/index.js';

const UNKNOWN_TRIBE = 999;

describe('settlerSex', () => {
  it('sexes young settlers by their age-class job', () => {
    expect(settlerSex(JOB_BABY_FEMALE, true)).toBe('female');
    expect(settlerSex(JOB_CHILD_FEMALE, true)).toBe('female');
    expect(settlerSex(JOB_BABY_MALE, true)).toBe('male');
    expect(settlerSex(JOB_CHILD_MALE, true)).toBe('male');
  });

  it('sexes an adult female only for the woman job, every other adult male', () => {
    expect(settlerSex(JOB_WOMAN, false)).toBe('female');
    expect(settlerSex(JOB_CIVILIST, false)).toBe('male');
    expect(settlerSex(null, false)).toBe('male');
    // The child job ids only mean "female/child" for a young (Age-carrying) settler; an adult carrying the
    // same raw id is male, exactly as the render body-join disambiguates by the `Age` component.
    expect(settlerSex(JOB_CHILD_FEMALE, false)).toBe('male');
  });
});

describe('characterName', () => {
  it('is stable and deterministic for a given entity', () => {
    const first = characterName(VIKING, JOB_CIVILIST, false, 7);
    expect(characterName(VIKING, JOB_CIVILIST, false, 7)).toBe(first);
    expect(first).not.toBe('');
  });

  it('is a first name plus a sex-matched Norse patronymic', () => {
    const man = characterName(VIKING, JOB_CIVILIST, false, 3);
    const woman = characterName(VIKING, JOB_WOMAN, false, 3);
    // "<First> <Father>sson" / "<First> <Father>sdóttir" — two words, patronymic suffix by sex.
    expect(man.split(' ')).toHaveLength(2);
    expect(man.endsWith('sson')).toBe(true);
    expect(woman.endsWith('sdóttir')).toBe(true);
  });

  it('gives a faction- and sex-appropriate name that matches the drawn body', () => {
    // A viking woman draws from the female pool, a viking man from the male pool — the two produce
    // disjoint names (differing patronymic suffix guarantees it), so a woman never gets a man's name.
    const femaleNames = new Set(
      Array.from({ length: 40 }, (_, id) => characterName(VIKING, JOB_WOMAN, false, id)),
    );
    const maleNames = new Set(
      Array.from({ length: 40 }, (_, id) => characterName(VIKING, JOB_CIVILIST, false, id)),
    );
    for (const name of femaleNames) expect(maleNames.has(name)).toBe(false);
  });

  it('names an unknown tribe from the viking fallback pool until it has its own', () => {
    const viaFallback = characterName(UNKNOWN_TRIBE, JOB_CIVILIST, false, 3);
    expect(viaFallback).toBe(characterName(VIKING, JOB_CIVILIST, false, 3));
  });

  it('spreads surnames across a batch of clustered ids (no shared family name by accident)', () => {
    // Regression: settlers spawned together get consecutive entity ids. The surname must NOT be constant
    // across such a batch (the old "everyone Ragnarsson / every soldier Bjørnsson" bug) — the coprime grid
    // scatter gives each a well-spread surname. 50 consecutive ids must yield many distinct surnames.
    const surnames = new Set(
      Array.from({ length: 50 }, (_, id) => characterName(VIKING, JOB_CIVILIST, false, id).split(' ')[1]),
    );
    expect(surnames.size).toBeGreaterThan(30);
  });

  it('inherits a husband/father surname through the family seam', () => {
    const husbandId = 12;
    const husbandSurname = characterName(VIKING, JOB_CIVILIST, false, husbandId).split(' ')[1];
    // A wife (female body) married to him takes his surname verbatim — the male "…sson", not her own
    // "…sdóttir" — and keeps her own first name.
    const wife = characterName(VIKING, JOB_WOMAN, false, 40, husbandId);
    expect(wife.endsWith('sson')).toBe(true);
    expect(wife.split(' ')[1]).toBe(husbandSurname);
    // A child likewise carries the father's surname.
    const child = characterName(VIKING, JOB_CHILD_MALE, true, 55, husbandId);
    expect(child.split(' ')[1]).toBe(husbandSurname);
    // Without the seam she keeps her own maiden patronymic, which differs from the husband's surname.
    const maiden = characterName(VIKING, JOB_WOMAN, false, 40);
    expect(maiden.split(' ')[1]).not.toBe(husbandSurname);
  });

  it('very rarely repeats — a large settlement of consecutive ids stays unique', () => {
    // The first-name × father-name cross product is thousands wide, so far more settlers than any real
    // settlement get a unique name. 1500 consecutive ids (either sex) must all differ.
    const count = 1500;
    const men = new Set(
      Array.from({ length: count }, (_, id) => characterName(VIKING, JOB_CIVILIST, false, id)),
    );
    const women = new Set(
      Array.from({ length: count }, (_, id) => characterName(VIKING, JOB_WOMAN, false, id)),
    );
    expect(men.size).toBe(count);
    expect(women.size).toBe(count);
  });
});
