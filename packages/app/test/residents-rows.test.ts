import { describe, expect, it } from 'vitest';
import {
  filtersActive,
  listResidents,
  NO_RESIDENT_FILTERS,
  pickedGroup,
  pickGestureOf,
  type ResidentRow,
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
    listResidents(people, { ...NO_RESIDENT_FILTERS, ...filters }, LOCALE, can).shown.map((p) => p.id);

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

  const listing = (filters: Partial<typeof NO_RESIDENT_FILTERS>) =>
    listResidents(people, { ...NO_RESIDENT_FILTERS, ...filters }, LOCALE, nobodyRetrains);

  it('counts the whole settlement on every chip while nothing is filtered', () => {
    const { counts } = listing({});
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

  it('narrows the lack chips to the picked group and the group chips to the picked lacks', () => {
    const civilians = listing({ group: 'civilians' }).counts;
    expect(civilians.lacks.home).toBe(1);
    expect(civilians.lacks.shoes).toBe(0);
    expect(civilians.groups.workers).toBe(2); // the group row swaps its own pick, so it stays whole

    const shoeless = listing({ lacks: ['shoes'] }).counts;
    expect(shoeless.groups).toMatchObject({ all: 2, workers: 2, civilians: 0 });
    expect(shoeless.lacks.shoes).toBe(2); // a picked lack counts the list it made
    expect(shoeless.lacks.post).toBe(1); // what adding this lack would leave
    expect(shoeless.lacks.home).toBe(0);
  });

  it('narrows every chip to the search text', () => {
    const { counts } = listing({ query: 'kowal' });
    expect(counts.groups).toMatchObject({ all: 1, workers: 1, heroes: 0 });
    expect(counts.lacks).toMatchObject({ post: 1, shoes: 1, mead: 1, home: 0 });
  });

  it('narrows the group chips to a picked profession and every chip to a can-become pick', () => {
    const smiths = listing({ profession: 'Kowal' }).counts;
    expect(smiths.groups).toMatchObject({ all: 1, workers: 1, heroes: 0 });

    const canSmith = (id: number, jobType: number): boolean => jobType === JOB_SMITH && id === 7;
    const { counts } = listResidents(
      people,
      { ...NO_RESIDENT_FILTERS, canBecome: JOB_SMITH },
      LOCALE,
      canSmith,
    );
    expect(counts.groups).toMatchObject({ all: 2, workers: 1, civilians: 1, women: 0 });
    expect(counts.lacks).toMatchObject({ home: 1, shoes: 1, weapon: 0 });
  });

  it('tallies the professions the other filters keep, in label order', () => {
    expect(listing({}).professions.slice(0, 3)).toEqual([
      { profession: 'Bohater', count: 2 },
      { profession: 'Cywil', count: 1 },
      { profession: 'Dziewczynka', count: 1 },
    ]);
    // The picked profession does not narrow its own options.
    expect(listing({ group: 'workers', profession: 'Kowal' }).professions).toEqual([
      { profession: 'Kowal', count: 1 },
      { profession: 'Piekarz', count: 1 },
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

describe('residents row picks', () => {
  const shown = [10, 11, 12, 13, 14];

  it('reads the press as a file list does', () => {
    expect(pickGestureOf({ range: false, toggle: false })).toBe('show');
    expect(pickGestureOf({ range: false, toggle: true })).toBe('toggle');
    expect(pickGestureOf({ range: true, toggle: false })).toBe('range');
    expect(pickGestureOf({ range: true, toggle: true })).toBe('add-range');
  });

  it('shows one person on a plain press, whatever was selected', () => {
    expect(pickedGroup('show', 12, new Set([10, 99]), shown, 10)).toEqual([12]);
  });

  it('toggles a row in and out of the group', () => {
    expect(pickedGroup('toggle', 12, new Set([10]), shown, null)).toEqual([10, 12]);
    expect(pickedGroup('toggle', 10, new Set([10, 12]), shown, null)).toEqual([12]);
  });

  it('picks the rows between the anchor and the press, in either direction', () => {
    expect(pickedGroup('range', 13, new Set([99]), shown, 11)).toEqual([11, 12, 13]);
    expect(pickedGroup('range', 10, new Set(), shown, 12)).toEqual([10, 11, 12]);
  });

  it('starts the range at the top while the anchor is unset or filtered out', () => {
    expect(pickedGroup('range', 12, new Set(), shown, null)).toEqual([10, 11, 12]);
    expect(pickedGroup('range', 11, new Set(), shown, 77)).toEqual([10, 11]);
  });

  it('adds the range to the group under both modifiers', () => {
    expect(pickedGroup('add-range', 13, new Set([10, 12]), shown, 12)).toEqual([10, 12, 13]);
  });
});
