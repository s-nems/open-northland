import { JobType } from '@open-northland/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settlerName } from '../../src/game/character-names/index.js';
import { installLocalizedNames } from '../../src/game/character-names/localized-names.js';
import { installPetNames, memoryPetNames, petNames } from '../../src/game/character-names/pet-names.js';
import type { SnapshotEntity } from '../../src/game/snapshot/index.js';
import { currentLocale, LOCALE_CODES, setActiveLocale } from '../../src/i18n/index.js';

let previousLocale = currentLocale();
beforeEach(() => {
  previousLocale = currentLocale();
  installPetNames(memoryPetNames());
  installLocalizedNames(currentLocale(), new Map());
});
afterEach(() => {
  setActiveLocale(previousLocale);
  installPetNames(memoryPetNames());
  installLocalizedNames(currentLocale(), new Map());
});

const entity = (components: SnapshotEntity['components']): SnapshotEntity => ({ id: 42, components });
const identity = { NameIdentity: { pool: 'egyptian-male', name: 'Nakht' } };
/** A dictionary for the pool `identity` names; a second pool spells the same raw name differently. */
const dictionary = new Map([
  ['egyptian-male', new Map([['Nakht', '纳赫特']])],
  ['viking-male', new Map([['Nakht', '纳克特']])],
]);

describe('settlerName', () => {
  it('uses the stored identity regardless of trade, age or relatives', () => {
    for (const extra of [
      {},
      { Age: { ticks: 2 } },
      { Marriage: { spouse: 10, child: 7 } },
      { Female: { female: true } },
    ]) {
      expect(settlerName({ jobs: [] }, entity({ ...identity, ...extra }))).toBe('Nakht');
    }
  });

  it('keeps the raw name where the locale has translated none, in every locale', () => {
    for (const locale of LOCALE_CODES) {
      setActiveLocale(locale);
      expect(settlerName({ jobs: [] }, entity(identity))).toBe('Nakht');
    }
  });

  it("reads the locale's translation by the pool the settler's name came from", () => {
    setActiveLocale('chs');
    installLocalizedNames('chs', dictionary);
    expect(settlerName({ jobs: [] }, entity(identity))).toBe('纳赫特');
    // The raw name the pools repeat is the same string, so the pool is what tells the two apart.
    expect(settlerName({ jobs: [] }, entity({ NameIdentity: { pool: 'viking-male', name: 'Nakht' } }))).toBe(
      '纳克特',
    );
    setActiveLocale('eng');
    expect(settlerName({ jobs: [] }, entity(identity))).toBe('Nakht');
    expect(settlerName({ jobs: [] }, entity({ NameIdentity: { name: 'Nakht' } }))).toBe('Nakht');
  });

  it('resolves script then the player’s own name then the generated identity', () => {
    const e = entity({ ...identity, ScriptedName: { stringId: 5 } });
    expect(settlerName({ jobs: [], mapText: () => 'Isis' }, e)).toBe('Isis');
    petNames().set(42, 'Ada');
    // The scripted name still wins, and a blank one falls through to the player's.
    expect(settlerName({ jobs: [], mapText: () => 'Isis' }, e)).toBe('Isis');
    expect(settlerName({ jobs: [], mapText: () => ' ' }, e)).toBe('Ada (Nakht)');
    expect(settlerName({ jobs: [] }, entity(identity))).toBe('Ada (Nakht)');
  });

  it('shows the name the player gave with the one it replaced beside it', () => {
    petNames().set(42, 'Ada');
    expect(settlerName({ jobs: [] }, entity(identity))).toBe('Ada (Nakht)');
    setActiveLocale('chs');
    installLocalizedNames('chs', dictionary);
    expect(settlerName({ jobs: [] }, entity(identity))).toBe('Ada (纳赫特)');
    // Taking the name back leaves the settler with the one it was generated with.
    petNames().set(42, '   ');
    expect(settlerName({ jobs: [] }, entity(identity))).toBe('纳赫特');
  });

  it('keeps hero names ahead of the pool, with map and player overrides ahead of the hero', () => {
    setActiveLocale('eng');
    const jobs = [JobType.parse({ typeId: 44, id: 'hero_sword_bjarni' })];
    const e = entity({ ...identity, Settler: { jobType: 44, tribe: 1 }, ScriptedName: { stringId: 1 } });
    expect(settlerName({ jobs }, e)).toBe('Bjarni');
    petNames().set(42, 'Ada');
    expect(settlerName({ jobs }, e)).toBe('Ada (Bjarni)');
    expect(settlerName({ jobs, mapText: () => 'Sigurd' }, e)).toBe('Sigurd');
  });

  it('uses a numbered localized fallback for an unknown person', () => {
    setActiveLocale('eng');
    expect(settlerName({ jobs: [] }, entity({ Settler: { tribe: 999 } }))).toBe('Person #42');
    setActiveLocale('pol');
    expect(settlerName({ jobs: [] }, entity({}))).toBe('Postać #42');
  });
});
