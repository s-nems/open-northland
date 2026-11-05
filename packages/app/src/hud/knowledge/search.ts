import { hasWords, searchWords } from '../dom/parts/name-search.js';
import { listedJobs, shownJobName } from './entry-blocks.js';
import type { EntryRef, KnowledgeBase } from './model.js';

/** One row a search can land on; `T` is what the caller opens. */
export interface SearchItem<T> {
  readonly name: string;
  readonly target: T;
}

export type EntrySearchGroup = 'animals' | 'buildings' | 'goods' | 'jobs';

export interface EntrySearchTarget {
  readonly group: EntrySearchGroup;
  readonly entry: EntryRef;
}

/** The items whose name holds every word of `query`, in list order; empty for a blank query. */
export function searchItems<T>(items: readonly SearchItem<T>[], query: string): readonly SearchItem<T>[] {
  const words = searchWords(query);
  if (words.length === 0) return [];
  return items.filter((item) => hasWords(item.name, words));
}

/** Every entry the search reaches, goods first; the caller appends article headings. */
export function entrySearchItems(base: KnowledgeBase): readonly SearchItem<EntrySearchTarget>[] {
  const item = (
    group: EntrySearchGroup,
    kind: EntryRef['kind'],
    id: string,
    name: string,
  ): SearchItem<EntrySearchTarget> => ({ name, target: { group, entry: { kind, id } } });
  return [
    ...base.goods.map((g) => item('goods', 'good', g.id, g.name)),
    ...base.buildings.map((b) => item('buildings', 'building', b.id, b.name)),
    ...listedJobs(base).map((j) => item('jobs', 'job', j.id, shownJobName(j))),
    ...base.animals.map((a) => item('animals', 'animal', String(a.tribe), a.name)),
  ];
}
