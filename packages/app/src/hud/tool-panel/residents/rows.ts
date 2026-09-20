/** Who a resident is, as the original subjects window groups its people: one group each. */
export type ResidentKind = 'child' | 'woman' | 'worker' | 'civilian' | 'soldier' | 'hero';

/** The top filter row: one choice at a time. */
export const RESIDENT_GROUPS = [
  'all',
  'men',
  'women',
  'children',
  'workers',
  'civilians',
  'soldiers',
  'heroes',
] as const;
export type ResidentGroup = (typeof RESIDENT_GROUPS)[number];

/** The bottom filter row: what a resident goes without. Any number at once, all of them required. */
export const RESIDENT_LACKS = [
  'home',
  'post',
  'tool',
  'shoes',
  'partner',
  'children',
  'weapon',
  'mead',
] as const;
export type ResidentLack = (typeof RESIDENT_LACKS)[number];

/** One person of the seat, as the window lists them. Plain data: the projection owns the sim reads. */
export interface ResidentRow {
  readonly id: number;
  readonly name: string;
  readonly kind: ResidentKind;
  readonly female: boolean;
  /** The job the settler holds; null for one without any. */
  readonly jobType: number | null;
  /** The profession as shown, which is also the Zawód filter's key: every soldier class reads as one. */
  readonly profession: string;
  /** A growing child's whole years; null for an adult. */
  readonly ageYears: number | null;
  /** The workplace's name; empty without a post. */
  readonly workplace: string;
  readonly lacks: readonly ResidentLack[];
}

const GROUP_TEST: Readonly<Record<ResidentGroup, (row: ResidentRow) => boolean>> = {
  all: () => true,
  men: (row) => row.kind !== 'child' && !row.female,
  // The original keeps heroines out of the women's list.
  women: (row) => row.kind === 'woman',
  children: (row) => row.kind === 'child',
  workers: (row) => row.kind === 'worker',
  civilians: (row) => row.kind === 'civilian',
  soldiers: (row) => row.kind === 'soldier',
  heroes: (row) => row.kind === 'hero',
};

export function inGroup(row: ResidentRow, group: ResidentGroup): boolean {
  return GROUP_TEST[group](row);
}

export type ResidentSortKey = 'name' | 'profession' | 'workplace' | 'lacks';

export interface ResidentSort {
  readonly key: ResidentSortKey;
  readonly descending: boolean;
}

export interface ResidentFilters {
  readonly group: ResidentGroup;
  readonly lacks: readonly ResidentLack[];
  /** A `ResidentRow.profession` to keep; empty keeps every one. */
  readonly profession: string;
  /** The job the listed people could take; null applies no such filter. */
  readonly canBecome: number | null;
  readonly query: string;
}

export const NO_RESIDENT_FILTERS: ResidentFilters = {
  group: 'all',
  lacks: [],
  profession: '',
  canBecome: null,
  query: '',
};

export function filtersActive(filters: ResidentFilters): boolean {
  return (
    filters.group !== 'all' ||
    filters.lacks.length > 0 ||
    filters.profession !== '' ||
    filters.canBecome !== null ||
    filters.query.trim() !== ''
  );
}

/** A row's answer to each filter on its own: a chip counts the rows its pick would list, which means
 *  every other filter held and its own swapped. */
interface FilterVerdict {
  readonly lacks: boolean;
  readonly profession: boolean;
  /** The can-become pick and the search text, which no chip or option swaps. */
  readonly rest: boolean;
}

/**
 * `canBecome` answers the job filter for a row: the sim's own rule, asked only while that filter is
 * set and only of a grown man, since the sim's trade orders refuse a child and a woman before that
 * rule is read. Approximation: a script's trade lock on a unit is not mirrored, so a locked man may
 * still be listed.
 */
function verdictOf(
  row: ResidentRow,
  filters: ResidentFilters,
  needle: string,
  locale: string,
  canBecome: (id: number, jobType: number) => boolean,
): FilterVerdict {
  const takesJob =
    filters.canBecome === null ||
    row.jobType === filters.canBecome ||
    (row.kind !== 'child' && !row.female && canBecome(row.id, filters.canBecome));
  const named =
    needle === '' ||
    [row.name, row.profession, row.workplace].some((text) => text.toLocaleLowerCase(locale).includes(needle));
  return {
    lacks: filters.lacks.every((lack) => row.lacks.includes(lack)),
    profession: filters.profession === '' || row.profession === filters.profession,
    rest: takesJob && named,
  };
}

export interface ResidentCounts {
  readonly groups: Readonly<Record<ResidentGroup, number>>;
  readonly lacks: Readonly<Record<ResidentLack, number>>;
}

export interface ResidentListing {
  /** The rows passing every filter at once, in the given order. */
  readonly shown: readonly ResidentRow[];
  /** What each chip would list under the other filters: a group chip swaps the group, a lack chip
   *  adds its lack to the picked ones. */
  readonly counts: ResidentCounts;
  /** The professions among the rows the other filters keep, in label order: the Zawód options. */
  readonly professions: readonly { readonly profession: string; readonly count: number }[];
}

export function listResidents(
  rows: readonly ResidentRow[],
  filters: ResidentFilters,
  locale: string,
  canBecome: (id: number, jobType: number) => boolean,
): ResidentListing {
  const groups = Object.fromEntries(RESIDENT_GROUPS.map((id) => [id, 0])) as Record<ResidentGroup, number>;
  const lacks = Object.fromEntries(RESIDENT_LACKS.map((id) => [id, 0])) as Record<ResidentLack, number>;
  const professions = new Map<string, number>();
  const shown: ResidentRow[] = [];
  const needle = filters.query.trim().toLocaleLowerCase(locale);
  for (const row of rows) {
    const verdict = verdictOf(row, filters, needle, locale, canBecome);
    if (!verdict.rest || !verdict.lacks) continue;
    const grouped = inGroup(row, filters.group);
    if (verdict.profession) {
      for (const id of RESIDENT_GROUPS) if (inGroup(row, id)) groups[id] += 1;
    }
    if (!grouped) continue;
    professions.set(row.profession, (professions.get(row.profession) ?? 0) + 1);
    if (!verdict.profession) continue;
    for (const id of row.lacks) lacks[id] += 1;
    shown.push(row);
  }
  return {
    shown,
    counts: { groups, lacks },
    professions: [...professions]
      .map(([profession, count]) => ({ profession, count }))
      .sort((a, b) => a.profession.localeCompare(b.profession, locale)),
  };
}

/**
 * How a row press changes the selection, as a file list does: a plain press shows that one person, a
 * toggle press (Ctrl or Cmd) puts the row in the group or takes it out, a range press (Shift) picks
 * every row from the anchor to the pressed one, and both at once add that range to the group.
 */
export type PickGesture = 'show' | 'toggle' | 'range' | 'add-range';

export function pickGestureOf(press: { readonly range: boolean; readonly toggle: boolean }): PickGesture {
  if (press.range) return press.toggle ? 'add-range' : 'range';
  return press.toggle ? 'toggle' : 'show';
}

/**
 * The selection a press on `id` leaves. `shown` is the list as ordered on screen; the range runs
 * from `anchor`, the last row pressed without Shift, or from the top while that row is not listed.
 */
export function pickedGroup(
  gesture: PickGesture,
  id: number,
  selected: ReadonlySet<number>,
  shown: readonly number[],
  anchor: number | null,
): readonly number[] {
  if (gesture === 'show') return [id];
  if (gesture === 'toggle') {
    return selected.has(id) ? [...selected].filter((other) => other !== id) : [...selected, id];
  }
  const from = Math.max(0, anchor === null ? 0 : shown.indexOf(anchor));
  const to = shown.indexOf(id);
  const range = to < 0 ? [id] : shown.slice(Math.min(from, to), Math.max(from, to) + 1);
  if (gesture === 'range') return range;
  return [...selected, ...range.filter((other) => !selected.has(other))];
}

/**
 * The list order: heroes lead under every key, as the original list keeps them; a row without a
 * workplace follows the posted ones in both directions; the lacks key opens with the neediest; ties fall back to the
 * name and then the id, so the order never depends on the snapshot's.
 */
export function sortResidents(
  rows: readonly ResidentRow[],
  sort: ResidentSort,
  locale: string,
): ResidentRow[] {
  const sign = sort.descending ? -1 : 1;
  const text = (a: string, b: string): number => a.localeCompare(b, locale);
  const byKey = (a: ResidentRow, b: ResidentRow): number => {
    switch (sort.key) {
      case 'name':
        return text(a.name, b.name);
      case 'profession':
        return text(a.profession, b.profession);
      case 'workplace':
        return text(a.workplace, b.workplace);
      case 'lacks':
        return b.lacks.length - a.lacks.length;
    }
  };
  const unposted = (row: ResidentRow): number => Number(sort.key === 'workplace' && row.workplace === '');
  return [...rows].sort(
    (a, b) =>
      Number(b.kind === 'hero') - Number(a.kind === 'hero') ||
      unposted(a) - unposted(b) ||
      sign * byKey(a, b) ||
      text(a.name, b.name) ||
      a.id - b.id,
  );
}

/** What the window keeps between openings, for the game: never browser storage. */
export interface ResidentsWindowState {
  readonly filters: ResidentFilters;
  readonly sort: ResidentSort;
  readonly scrollTop: number;
}

/** The list opens by profession: a generated name tells the player little. */
export const INITIAL_RESIDENTS_STATE: ResidentsWindowState = {
  filters: NO_RESIDENT_FILTERS,
  sort: { key: 'profession', descending: false },
  scrollTop: 0,
};
