import { describe, expect, it } from 'vitest';
import {
  filtersActive,
  matchesResident,
  NO_RESIDENT_FILTERS,
  professionTally,
  type ResidentRow,
  residentCounts,
  sortResidents,
} from '../src/hud/tool-panel/residents/rows.js';

const LOCALE = 'pl';
const JOB_BAKER = 20;
const JOB_SMITH = 13;

function row(id: number, over: Partial<ResidentRow>): ResidentRow {
  return {
    id,
    name: `Osadnik ${id}`,
    kind: 'worker',
    female: false,
    jobType: JOB_BAKER,
    profession: 'Piekarz',
    ageYears: null,
    workplace: '',
    lacks: [],
    ...over,
  };
}

const nobodyRetrains = (_id: number, _jobType: number): boolean => false;

describe('residents list filters', () => {
  const people = [
    row(1, { name: 'Arne', workplace: 'Piekarnia', lacks: ['shoes'] }),
    row(2, { name: 'Bjorn', jobType: JOB_SMITH, profession: 'Kowal', lacks: ['post', 'shoes', 'mead'] }),
    row(3, { name: 'Astrid', kind: 'woman', female: true, jobType: 5, profession: 'Kobieta' }),
    row(4, { name: 'Liv', kind: 'child', female: true, jobType: 3, profession: 'Dziewczynka', ageYears: 7 }),
    row(5, { name: 'Bjarni', kind: 'hero', jobType: 50, profession: 'Bohater' }),
    row(6, { name: 'Hatschi', kind: 'hero', female: true, jobType: 55, profession: 'Bohater' }),
    row(7, { name: 'Egil', kind: 'civilian', jobType: 6, profession: 'Cywil', lacks: ['home'] }),
    row(8, { name: 'Ulf', kind: 'soldier', jobType: 31, profession: 'Żołnierz', lacks: ['weapon'] }),
  ];
  const shown = (filters: Partial<typeof NO_RESIDENT_FILTERS>, can = nobodyRetrains): number[] =>
    people
      .filter((p) => matchesResident(p, { ...NO_RESIDENT_FILTERS, ...filters }, LOCALE, can))
      .map((p) => p.id);

  it('groups people as the original subjects window does', () => {
    expect(shown({ group: 'all' })).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(shown({ group: 'men' })).toEqual([1, 2, 5, 7, 8]);
    expect(shown({ group: 'women' })).toEqual([3]); // a heroine is no entry of the women's list
    expect(shown({ group: 'children' })).toEqual([4]);
    expect(shown({ group: 'workers' })).toEqual([1, 2]);
    expect(shown({ group: 'civilians' })).toEqual([7]);
    expect(shown({ group: 'soldiers' })).toEqual([8]);
    expect(shown({ group: 'heroes' })).toEqual([5, 6]);
  });

  it('requires every picked lack at once and combines it with the group', () => {
    expect(shown({ lacks: ['shoes'] })).toEqual([1, 2]);
    expect(shown({ lacks: ['shoes', 'post'] })).toEqual([2]);
    expect(shown({ group: 'soldiers', lacks: ['shoes'] })).toEqual([]);
  });

  it('searches the name, the profession and the workplace, whatever the case', () => {
    expect(shown({ query: 'PIEK' })).toEqual([1]);
    expect(shown({ query: 'kowal' })).toEqual([2]);
    expect(shown({ query: ' bj' })).toEqual([2, 5]);
    expect(shown({ query: 'nikt taki' })).toEqual([]);
  });

  it('keeps the holders of a trade and the people the sim would let take it', () => {
    const canSmith = (id: number, jobType: number): boolean => jobType === JOB_SMITH && id === 7;
    expect(shown({ canBecome: JOB_SMITH }, canSmith)).toEqual([2, 7]);
    expect(shown({ profession: 'Kowal' })).toEqual([2]);
  });

  it('offers a trade to no child and no woman, whatever the sim rule says of them', () => {
    const everyone = (): boolean => true;
    expect(shown({ canBecome: JOB_SMITH }, everyone)).toEqual([1, 2, 5, 7, 8]);
  });

  it('knows a set filter from the resting state', () => {
    expect(filtersActive(NO_RESIDENT_FILTERS)).toBe(false);
    expect(filtersActive({ ...NO_RESIDENT_FILTERS, query: '  ' })).toBe(false);
    expect(filtersActive({ ...NO_RESIDENT_FILTERS, lacks: ['home'] })).toBe(true);
    expect(filtersActive({ ...NO_RESIDENT_FILTERS, canBecome: JOB_SMITH })).toBe(true);
  });

  it('counts the whole settlement on every chip', () => {
    const counts = residentCounts(people);
    expect(counts.groups).toEqual({
      all: 8,
      men: 5,
      women: 1,
      children: 1,
      workers: 2,
      civilians: 1,
      soldiers: 1,
      heroes: 2,
    });
    expect(counts.lacks.shoes).toBe(2);
    expect(counts.lacks.partner).toBe(0);
  });

  it('tallies the professions present in label order', () => {
    expect(professionTally(people, LOCALE).slice(0, 3)).toEqual([
      { profession: 'Bohater', count: 2 },
      { profession: 'Cywil', count: 1 },
      { profession: 'Dziewczynka', count: 1 },
    ]);
  });
});

describe('residents list order', () => {
  const people = [
    row(1, { name: 'Sven', profession: 'Piekarz', workplace: 'Piekarnia' }),
    row(2, { name: 'Arne', profession: 'Kowal', workplace: '', lacks: ['post', 'tool'] }),
    row(3, { name: 'Bjarni', kind: 'hero', profession: 'Bohater' }),
    row(4, { name: 'Arne', profession: 'Kowal', workplace: 'Kuźnia', lacks: ['shoes'] }),
  ];
  const ids = (key: Parameters<typeof sortResidents>[1]['key'], descending = false): number[] =>
    sortResidents(people, { key, descending }, LOCALE).map((p) => p.id);

  it('leads with the heroes under every key and direction', () => {
    for (const key of ['name', 'profession', 'workplace', 'lacks'] as const) {
      expect(ids(key)[0]).toBe(3);
      expect(ids(key, true)[0]).toBe(3);
    }
  });

  it('orders by the key, then the name, then the id', () => {
    expect(ids('name')).toEqual([3, 2, 4, 1]);
    expect(ids('profession')).toEqual([3, 2, 4, 1]);
    expect(ids('profession', true)).toEqual([3, 1, 2, 4]);
  });

  it('keeps the unposted after the posted in both directions', () => {
    expect(ids('workplace')).toEqual([3, 4, 1, 2]);
    expect(ids('workplace', true)).toEqual([3, 1, 4, 2]);
  });

  it('opens the lacks key with the neediest', () => {
    expect(ids('lacks')).toEqual([3, 2, 4, 1]);
  });
});
