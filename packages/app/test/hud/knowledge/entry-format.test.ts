import { describe, expect, it } from 'vitest';
import {
  cadenceText,
  equipDurability,
  equipEffects,
  practiceText,
  rangeText,
  slowdownPercent,
  speedVerdict,
  statusText,
  weaponClassText,
} from '../../../src/hud/knowledge/entry-format.js';
import type { KnowledgeWeapon } from '../../../src/hud/knowledge/model.js';
import { setActiveLocale } from '../../../src/i18n/index.js';

const UNARMED = 1;
const SPEAR = 2;
const BOW = 6;
const TICKS_PER_SECOND = 12;

const weapon = (over: Partial<KnowledgeWeapon>): KnowledgeWeapon => ({
  typeId: 1,
  id: 'spear',
  jobType: 32,
  filmJob: null,
  jobName: null,
  goodType: null,
  goodName: null,
  mainType: SPEAR,
  weight: 0,
  minRange: 1,
  maxRange: 1,
  damage: {},
  clipTicks: TICKS_PER_SECOND * 2,
  blows: 1,
  usable: true,
  ...over,
});

describe('entry formatting', () => {
  it('gives a range its unit and folds an equal pair', () => {
    expect(rangeText({ minRange: 4, maxRange: 23 })).toContain('4-23');
    expect(rangeText({ minRange: 1, maxRange: 1 })).toMatch(/^1 /);
  });

  it('counts hexes in the plural of the last number', () => {
    setActiveLocale('pol');
    expect(rangeText({ minRange: 1, maxRange: 1 })).toBe('1 hex');
    expect(rangeText({ minRange: 1, maxRange: 2 })).toBe('1-2 hexy');
    expect(rangeText({ minRange: 3, maxRange: 15 })).toBe('3-15 hexów');
  });

  it('names the blows only when one clip lands several', () => {
    expect(cadenceText(weapon({ blows: 1 }))).not.toContain('5');
    expect(cadenceText(weapon({ blows: 5 }))).toContain('5');
    expect(cadenceText(weapon({ clipTicks: null }))).toBe('-');
  });

  it('tells a fist, a blade and a bow apart', () => {
    const texts = [UNARMED, SPEAR, BOW].map((mainType) => weaponClassText({ mainType }, UNARMED));
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('compares a step with a person: longer is slower', () => {
    expect(speedVerdict(8, 6)).toBe('slower');
    expect(speedVerdict(6, 6)).toBe('same');
    expect(speedVerdict(5, 6)).toBe('faster');
  });

  it('counts the share a step grows by', () => {
    expect(slowdownPercent(7, 6)).toBe(17);
  });

  it('caps the missing names and counts the rest', () => {
    const line = statusText({ kind: 'locked', missing: ['a', 'b', 'c', 'd', 'e'] });
    expect(line).toContain('a, b, c');
    expect(line).not.toContain('d,');
    expect(line).toContain('2');
    expect(statusText({ kind: 'available' })).toBeNull();
  });

  it('names the trade a practice is earned in', () => {
    const requirement = { route: 'need', amount: 10, experience: ['Hunting'], fromJobs: [15] } as const;
    expect(practiceText(requirement, () => 'Hunter')).toContain('Hunter');
    expect(practiceText({ ...requirement, fromJobs: [] }, () => null)).not.toContain('(');
  });

  it('reads a good effect off its equip fields', () => {
    const effects = equipEffects(
      { category: 'misc', wears: true, uses: 2, restorePct: { hunger: 50, fatigue: 50 } },
      (ticks) => ticks,
    );
    expect(effects).toHaveLength(2);
    expect(effects.every((line) => line.includes('50'))).toBe(true);
  });

  it('says how long a good lasts by its kind', () => {
    expect(equipDurability({ category: 'misc', wears: true, uses: 2 })).toContain('2');
    expect(equipDurability({ category: 'misc', wears: false })).toBeNull();
  });

  it('formats through the active locale', () => {
    setActiveLocale('pol');
    expect(cadenceText(weapon({ clipTicks: 15 }))).toContain('1,3');
    setActiveLocale('eng');
    expect(cadenceText(weapon({ clipTicks: 15 }))).toContain('1.3');
    setActiveLocale('pol');
  });
});
