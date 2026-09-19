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

/**
 * Whether the row passes every filter at once. `canBecome` answers the job filter for a row: the sim's
 * own rule, asked only while that filter is set and only of a grown man, since the sim's trade orders
 * refuse a child and a woman before that rule is read. Approximation: a script's trade lock on a unit
 * is not mirrored, so a locked man may still be listed.
 */
export function matchesResident(
  row: ResidentRow,
  filters: ResidentFilters,
  locale: string,
  canBecome: (id: number, jobType: number) => boolean,
): boolean {
  if (!inGroup(row, filters.group)) return false;
  for (const lack of filters.lacks) if (!row.lacks.includes(lack)) return false;
  if (filters.profession !== '' && row.profession !== filters.profession) return false;
  if (
    filters.canBecome !== null &&
    row.jobType !== filters.canBecome &&
    (row.kind === 'child' || row.female || !canBecome(row.id, filters.canBecome))
  ) {
    return false;
  }
  const needle = filters.query.trim().toLocaleLowerCase(locale);
  if (needle === '') return true;
  return [row.name, row.profession, row.workplace].some((text) =>
    text.toLocaleLowerCase(locale).includes(needle),
  );
}

/** How many people each chip stands for: the whole settlement, whatever else is filtered. */
export interface ResidentCounts {
  readonly groups: Readonly<Record<ResidentGroup, number>>;
  readonly lacks: Readonly<Record<ResidentLack, number>>;
}

export function residentCounts(rows: readonly ResidentRow[]): ResidentCounts {
  const groups = Object.fromEntries(RESIDENT_GROUPS.map((id) => [id, 0])) as Record<ResidentGroup, number>;
  const lacks = Object.fromEntries(RESIDENT_LACKS.map((id) => [id, 0])) as Record<ResidentLack, number>;
  for (const row of rows) {
    for (const id of RESIDENT_GROUPS) if (inGroup(row, id)) groups[id] += 1;
    for (const id of row.lacks) lacks[id] += 1;
  }
  return { groups, lacks };
}

/** The professions present, each with its head count, in label order: the Zawód filter's options. */
export function professionTally(
  rows: readonly ResidentRow[],
  locale: string,
): readonly { readonly profession: string; readonly count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.profession, (counts.get(row.profession) ?? 0) + 1);
  return [...counts]
    .map(([profession, count]) => ({ profession, count }))
    .sort((a, b) => a.profession.localeCompare(b.profession, locale));
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
