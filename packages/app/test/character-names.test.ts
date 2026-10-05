import { JobType } from '@open-northland/data';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { settlerName } from '../src/game/character-names/index.js';
import type { SnapshotEntity } from '../src/game/snapshot.js';
import { currentLocale, setActiveLocale } from '../src/i18n/index.js';

let previousLocale = currentLocale();
beforeEach(() => {
  previousLocale = currentLocale();
});
afterEach(() => setActiveLocale(previousLocale));

const entity = (components: SnapshotEntity['components']): SnapshotEntity => ({ id: 42, components });
const identity = { NameIdentity: { pool: 'egyptian-male', name: 'Nakht' } };

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
  it('keeps proper names identical across locales', () => {
    for (const locale of ['pol', 'eng'] as const) {
      setActiveLocale(locale);
      expect(settlerName({ jobs: [] }, entity(identity))).toBe('Nakht');
    }
  });
  it('resolves script then player then generated identity, skipping missing or blank text', () => {
    const e = entity({ ...identity, GivenName: { name: 'Ada' }, ScriptedName: { stringId: 5 } });
    expect(settlerName({ jobs: [], mapText: () => 'Isis' }, e)).toBe('Isis');
    expect(settlerName({ jobs: [], mapText: () => ' ' }, e)).toBe('Ada');
    expect(settlerName({ jobs: [] }, e)).toBe('Ada');
  });
  it('keeps hero names ahead of the pool, with map and player overrides ahead of the hero', () => {
    setActiveLocale('eng');
    const jobs = [JobType.parse({ typeId: 44, id: 'hero_sword_bjarni' })];
    const e = entity({ ...identity, Settler: { jobType: 44, tribe: 1 } });
    expect(settlerName({ jobs }, e)).toBe('Bjarni');
    const overridden = entity({ ...e.components, GivenName: { name: 'Ada' }, ScriptedName: { stringId: 1 } });
    expect(settlerName({ jobs }, overridden)).toBe('Ada');
    expect(settlerName({ jobs, mapText: () => 'Sigurd' }, overridden)).toBe('Sigurd');
  });
  it('keeps authored names whole, including spaces', () => {
    const e = entity({ ...identity, ScriptedName: { stringId: 5 } });
    expect(settlerName({ jobs: [], mapText: () => 'Abd al-Rahman' }, e)).toBe('Abd al-Rahman');
  });
  it('uses a numbered localized fallback for an unknown person', () => {
    setActiveLocale('eng');
    expect(settlerName({ jobs: [] }, entity({ Settler: { tribe: 999 } }))).toBe('Person #42');
    setActiveLocale('pol');
    expect(settlerName({ jobs: [] }, entity({}))).toBe('Postać #42');
  });
});
