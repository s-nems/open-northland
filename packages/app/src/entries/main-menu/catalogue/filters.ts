import { MAP_TEXT_LANGUAGES, type MapTextLanguage } from '@open-northland/data';
import {
  type DropdownChoice,
  type DropdownHandle,
  dropdownControl,
} from '../../../hud/dom/parts/dropdown.js';
import { quietTextField } from '../../../hud/dom/parts/text-field.js';
import { compareLabels, formatMessage, messages } from '../../../i18n/index.js';
import { segControl } from '../../../view/settings/controls.js';
import { node } from '../dom.js';
import { authorPicker } from './author-picker.js';
import { formatCount, LANGUAGE_CODES } from './card.js';
import { type CatalogueRow, MAP_SIZES, type MapSize } from './model.js';
import {
  authorCounts,
  CATALOGUE_SORTS,
  type CatalogueQuery,
  type CatalogueSort,
  DEFAULT_CATALOGUE_QUERY,
  DOWNLOAD_MODES,
  type DownloadMode,
  type FacetCounts,
  facetCounts,
  hasActiveFilters,
  KIND_FILTERS,
  type KindFilter,
  PLAYER_BUCKETS,
  type PlayerBucket,
  SOURCE_FILTERS,
  type SourceFilter,
} from './query.js';

const ANY = 'any';
type Any = typeof ANY;

export interface CatalogueFilters {
  /** Row 1 (search, kind, sort) over row 2 (facet pills, toggle chips, reset). */
  readonly root: HTMLElement;
  readonly trailing: HTMLElement;
  /** The rows the facet counts and the authors come from; counted here once, not per filter change. */
  setRows(rows: readonly CatalogueRow[]): void;
  /** Applies a change from outside the bar, such as the panel's author link, and repaints the bar. */
  update(patch: Partial<CatalogueQuery>): void;
  /** Resets every filter, keeping the search and the sort. */
  reset(): void;
}

function bucketLabel(bucket: PlayerBucket): string {
  if (bucket.max === Number.POSITIVE_INFINITY)
    return formatMessage(messages().mapCatalogue.playerBucketPlus, { min: bucket.min });
  return bucket.min === bucket.max ? String(bucket.min) : `${bucket.min}-${bucket.max}`;
}

interface Pill<T extends string> {
  readonly root: HTMLElement;
  setEntries(entries: readonly DropdownChoice<T | Any>[]): void;
  setActive(id: T | null): void;
}

/** A facet as a compact pill: its caption, the chosen value while one is, and a clear button. */
function facetPill<T extends string>(
  label: string,
  entries: readonly DropdownChoice<T | Any>[],
  onPick: (id: T | null) => void,
): Pill<T> {
  const control: DropdownHandle<T | Any> = dropdownControl<T | Any>({
    label,
    className: 'main-menu__dropdown',
    entries,
    active: ANY,
    onPick: (id) => onPick(id === ANY ? null : (id as T)),
  });
  const { root } = control;
  root.classList.add('catalogue-pill');
  const caption = node('span', 'catalogue-pill__caption', label);
  caption.addEventListener('click', () => control.button.click());
  const clear = node('button', 'catalogue-pill__clear');
  clear.type = 'button';
  clear.setAttribute('aria-label', formatMessage(messages().mapCatalogue.clearFilter, { filter: label }));
  clear.addEventListener('click', () => onPick(null));
  root.prepend(caption);
  control.button.after(clear);
  return {
    root,
    setEntries: (next) => control.setEntries(next),
    setActive(id) {
      control.setActive(id ?? ANY);
      root.classList.toggle('is-any', id === null);
      root.classList.toggle('is-set', id !== null);
      clear.hidden = id === null;
    },
  };
}

function toggleChip(label: string, title: string, onToggle: () => void): HTMLButtonElement {
  const chip = node('button', 'catalogue-toggle', label);
  chip.type = 'button';
  chip.title = title;
  chip.addEventListener('click', onToggle);
  return chip;
}

/** The browse tab's two-row filter bar; every change hands the whole new query on. */
export function catalogueFilters(
  initial: CatalogueQuery,
  onChange: (query: CatalogueQuery) => void,
): CatalogueFilters {
  const text = messages().mapCatalogue;
  const labels = text.filterLabels;
  let query = initial;
  let counts: FacetCounts | null = null;

  const set = (patch: Partial<CatalogueQuery>): void => {
    query = { ...query, ...patch };
    paint();
    onChange(query);
  };

  const search = quietTextField(node('input', 'catalogue-toolbar__search'));
  search.type = 'search';
  search.placeholder = text.searchPlaceholder;
  search.setAttribute('aria-label', text.searchLabel);
  search.value = query.text;
  search.addEventListener('input', () => set({ text: search.value }));

  const kind = segControl<KindFilter>(
    KIND_FILTERS.map((id) => ({ id, label: text.kinds[id] })),
    query.kind,
    (id) => set({ kind: id }),
  );
  kind.root.classList.add('catalogue-toolbar__kind');
  kind.root.setAttribute('aria-label', labels.kind);

  const sort = dropdownControl<CatalogueSort>({
    label: text.sortLabel,
    className: 'main-menu__dropdown',
    entries: CATALOGUE_SORTS.map((id) => ({ id, label: text.sorts[id] })),
    active: query.sort,
    onPick: (id) => set({ sort: id }),
  });
  sort.root.classList.add('catalogue-pill', 'catalogue-sort');
  const sortCaption = node('span', 'catalogue-pill__caption', text.sortCaption);
  sortCaption.addEventListener('click', () => sort.button.click());
  sort.root.prepend(sortCaption);

  const count = (map: ReadonlyMap<string, number> | undefined, key: string): string | undefined => {
    const value = map?.get(key);
    return value === undefined ? undefined : formatCount(value);
  };
  const playerEntries = (): DropdownChoice<string>[] => [
    { id: ANY, label: text.anyPlayers },
    ...PLAYER_BUCKETS.map((bucket) => {
      const detail = count(counts?.players, bucket.id);
      return { id: bucket.id, label: bucketLabel(bucket), ...(detail === undefined ? {} : { detail }) };
    }),
  ];
  const languageEntries = (): DropdownChoice<MapTextLanguage | Any>[] => [
    { id: ANY, label: text.anyLanguage },
    ...MAP_TEXT_LANGUAGES.map((id) => {
      const detail = count(counts?.languages, id);
      return {
        id,
        label: text.languageNames[id],
        short: LANGUAGE_CODES[id],
        ...(detail === undefined ? {} : { detail }),
      };
    }),
  ];
  const sizeEntries = (): DropdownChoice<MapSize | Any>[] => [
    { id: ANY, label: text.sizes.any },
    ...MAP_SIZES.map((id) => {
      const detail = count(counts?.sizes, id);
      return { id, label: text.sizes[id], ...(detail === undefined ? {} : { detail }) };
    }),
  ];
  const downloadEntries = (): DropdownChoice<Exclude<DownloadMode, 'any'> | Any>[] =>
    DOWNLOAD_MODES.map((id) => {
      const detail = id === ANY ? undefined : count(counts?.downloads, id);
      return {
        id,
        label: text.downloadModes[id],
        ...(id === ANY ? {} : { short: text.downloadModeValues[id] }),
        ...(detail === undefined ? {} : { detail }),
      };
    });
  const sourceEntries = (): DropdownChoice<SourceFilter>[] =>
    SOURCE_FILTERS.map((id) => {
      const detail = id === ANY ? undefined : count(counts?.sources, id);
      return {
        id,
        label: id === ANY ? text.anySource : text.sources[id],
        ...(detail === undefined ? {} : { detail }),
      };
    });

  const players = facetPill<string>(labels.players, playerEntries(), (id) => set({ players: id }));
  const language = facetPill<MapTextLanguage>(labels.language, languageEntries(), (id) =>
    set({ language: id }),
  );
  const size = facetPill<MapSize>(labels.size, sizeEntries(), (id) => set({ size: id }));
  const author = authorPicker((name) => set({ author: name }));
  const download = facetPill<Exclude<DownloadMode, 'any'>>(labels.download, downloadEntries(), (id) =>
    set({ download: id ?? 'any' }),
  );
  const source = facetPill<SourceFilter>(labels.source, sourceEntries(), (id) =>
    set({ source: id ?? 'any' }),
  );
  const series = toggleChip(text.seriesChip, text.seriesTitle, () => set({ seriesOnly: !query.seriesOnly }));
  const hideOwned = toggleChip(text.hideOwned, text.hideOwnedTitle, () =>
    set({ hideOwned: !query.hideOwned }),
  );
  const resetButton = node('button', 'main-menu__ghost catalogue-toolbar__reset', text.resetFilters);
  resetButton.type = 'button';
  const reset = (): void => {
    const { text: typed, sort: order } = query;
    set({ ...DEFAULT_CATALOGUE_QUERY, text: typed, sort: order });
  };
  resetButton.addEventListener('click', reset);

  const root = node('div', 'catalogue-toolbar');
  const top = node('div', 'catalogue-toolbar__row is-main');
  top.append(search, kind.root);
  const facets = node('div', 'catalogue-toolbar__row is-facets');
  facets.append(
    sort.root,
    players.root,
    language.root,
    size.root,
    author.root,
    download.root,
    source.root,
    series,
    hideOwned,
    resetButton,
  );
  const trailing = node('div', 'catalogue-toolbar__trailing');
  facets.append(trailing);
  root.append(top, facets);

  function paint(): void {
    if (search.value !== query.text) search.value = query.text;
    kind.setActive(query.kind);
    sort.setActive(query.sort);
    players.setActive(query.players);
    language.setActive(query.language);
    size.setActive(query.size);
    author.setActive(query.author);
    download.setActive(query.download === 'any' ? null : query.download);
    source.setActive(query.source === 'any' ? null : query.source);
    series.setAttribute('aria-pressed', String(query.seriesOnly));
    hideOwned.setAttribute('aria-pressed', String(query.hideOwned));
    resetButton.hidden = !hasActiveFilters(query);
  }
  paint();

  return {
    root,
    trailing,
    setRows(rows) {
      counts = facetCounts(rows);
      players.setEntries(playerEntries());
      language.setEntries(languageEntries());
      size.setEntries(sizeEntries());
      download.setEntries(downloadEntries());
      source.setEntries(sourceEntries());
      // A catalogue without the mapdb has no source to choose between; the pill stays out of the way.
      source.root.hidden = (counts.sources.get('wikinger-tommy') ?? 0) === 0;
      author.setAuthors(authorCounts(rows, compareLabels()));
    },
    update: set,
    reset,
  };
}
