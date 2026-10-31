import type { KnowledgeBase } from './base.js';
import type { EntryRef } from './model.js';

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

const COMBINING_MARKS = /\p{M}/gu;
const WHITESPACE = /\s+/;

/** `text` lowered with its diacritics gone; ł has no decomposition, so it folds by hand. */
export function foldSearchText(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(COMBINING_MARKS, '').replaceAll('ł', 'l');
}

/** The items whose name holds every word of `query`, in list order; empty for a blank query. */
export function searchItems<T>(items: readonly SearchItem<T>[], query: string): readonly SearchItem<T>[] {
  const words = foldSearchText(query).split(WHITESPACE).filter(Boolean);
  if (words.length === 0) return [];
  return items.filter((item) => {
    const name = foldSearchText(item.name);
    return words.every((word) => name.includes(word));
  });
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
    ...base.jobs.map((j) => item('jobs', 'job', j.id, j.name)),
    ...base.animals.map((a) => item('animals', 'animal', String(a.tribe), a.name)),
  ];
}
