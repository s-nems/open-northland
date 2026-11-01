import type { CatalogBrowseEntry } from '@open-northland/data';
import { IR_VERSION } from '@open-northland/data/ir-version';
import type { LocalSourceRecord } from '../../../content/local-import/source.js';
import { loadMapList } from '../../../content/map/maps-index.js';
import {
  apiBaseUrl,
  catalogFileUrl,
  catalogThumbnailUrl,
  fetchCatalog,
  fetchCatalogEntry,
  findMapSource,
  type InstalledMapRecord,
  installCatalogEntry,
  installedMapStore,
} from '../../../content/map-source/index.js';
import { errorText } from '../../../diag/error-text.js';
import { bcp47Tag, compareLabels, formatMessage, messages, pluralForm } from '../../../i18n/index.js';
import { patchStoredSettings, readStoredSettings } from '../../../view/settings/store.js';
import { menuConfirm } from '../confirm.js';
import { node } from '../dom.js';
import { type MapSelectItem, mapSourceItem } from '../map-select/model.js';
import { type CardDate, type CatalogueContext, formatCount } from './card.js';
import { catalogueCardGrid } from './card-grid.js';
import { catalogueDetail } from './detail.js';
import { catalogueEntryDetails } from './entry-details.js';
import { catalogueFilters } from './filters.js';
import { installedPane } from './installed.js';
import { localImportControls } from './local-import.js';
import {
  type CatalogueRow,
  catalogueRows,
  type InstalledGroup,
  installedGroups,
  installedMapRows,
  NO_SHIPPED_MAPS,
  type ShippedMaps,
  shippedMaps,
} from './model.js';
import { type CatalogueQuery, DEFAULT_CATALOGUE_QUERY, hasActiveFilters, queryRows } from './query.js';

export type CatalogueTab = 'browse' | 'installed';
const CATALOGUE_TABS: readonly CatalogueTab[] = ['browse', 'installed'];

/** Survives leaving the view, so a round trip to the lobby keeps the tab, query and open entry. */
export interface CatalogueMemory {
  tab: CatalogueTab;
  query: CatalogueQuery;
  selectedId: string | null;
}

export function initialCatalogueMemory(): CatalogueMemory {
  return {
    tab: 'browse',
    query: { ...DEFAULT_CATALOGUE_QUERY, source: readStoredSettings().catalogueSource },
    selectedId: null,
  };
}

export interface CatalogueViewOptions {
  readonly memory: CatalogueMemory;
  /** `play` opens the lobby from the main menu; `choose` picks the map for a multiplayer room. */
  readonly purpose: 'play' | 'choose';
  readonly onPick: (item: MapSelectItem) => void;
  /** Maps were installed or removed; the owner's map lists read their sources again. */
  readonly onInstalledChanged?: () => void;
}

export interface CatalogueView {
  /** The Browse / Installed switch, for the owner's header. */
  readonly tabs: HTMLElement;
  /** How many maps the catalogue lists or the filters show, for the owner's header before the tabs. */
  readonly count: HTMLElement;
  readonly body: HTMLElement;
  dispose(): void;
}

const isUpdate = (group: InstalledGroup): boolean =>
  group.row?.status === 'updatable' || group.row?.status === 'redownload';

/** The culturesnation.pl catalogue as a filterable card grid beside a detail panel that always shows
 *  the selected entry, with an Installed tab, for the main menu and a multiplayer room. */
export function catalogueView(options: CatalogueViewOptions): CatalogueView {
  const { memory } = options;
  const text = messages().mapCatalogue;
  const api = apiBaseUrl();
  const store = installedMapStore();
  const scope = new AbortController();

  let entries: readonly CatalogBrowseEntry[] | null = null;
  let failure: unknown = null;
  let installed: readonly InstalledMapRecord[] = [];
  let localSources: readonly LocalSourceRecord[] = [];
  let storageState: 'loading' | 'ready' | 'error' = store === null ? 'ready' : 'loading';
  let hasInstalledSnapshot = store === null;
  let installedRead = 0;
  let shipped: ShippedMaps = NO_SHIPPED_MAPS;
  let rows: readonly CatalogueRow[] = [];
  /** Download progress per entry id, as a fraction. */
  const downloads = new Map<string, number>();
  /** The last download or removal error per entry id. */
  const failures = new Map<string, string>();

  const details = catalogueEntryDetails(api, scope.signal, () => paintDetail(text.panelEmpty));

  const rowOf = (entryId: string): CatalogueRow | undefined => rows.find((row) => row.entry.id === entryId);
  const isInstalled = (entryId: string): boolean => installed.some((record) => record.entryId === entryId);

  const ctx: CatalogueContext = {
    purpose: options.purpose,
    canStore: store !== null,
    thumbnail: (entry) => catalogThumbnailUrl(api, entry),
    fileUrl: (entry) => catalogFileUrl(api, entry),
    progress: (entryId) => downloads.get(entryId),
    failure: (entryId) => failures.get(entryId),
    download: (row) => startDownload(row),
    remove: (entryId) => void removeInstall(entryId),
    pick: (row) => void pick(row),
    open: (entryId) => select(entryId),
  };

  const tabs = node('div', 'main-menu__seg catalogue__tabs');
  const tabButtons = new Map<CatalogueTab, HTMLButtonElement>();
  for (const tab of CATALOGUE_TABS) {
    const button = node('button', 'main-menu__seg-btn');
    button.type = 'button';
    button.addEventListener('click', () => {
      memory.tab = tab;
      render();
    });
    tabButtons.set(tab, button);
    tabs.append(button);
  }
  const count = node('p', 'catalogue__count');
  count.setAttribute('role', 'status');

  const body = node('div', 'catalogue');
  // The source a player starts the catalogue with is their standing choice, so it persists.
  let persistedSource = memory.query.source;
  const filters = catalogueFilters(memory.query, (query) => {
    memory.query = query;
    if (query.source !== persistedSource) {
      persistedSource = query.source;
      patchStoredSettings({ catalogueSource: query.source });
    }
    render();
  });
  const storageNotice = node('div', 'catalogue__storage-notice');
  const main = node('div', 'catalogue__main');
  const results = node('div', 'catalogue__results');
  const cardGrid = catalogueCardGrid(ctx, () => detail.focusAction());
  const grid = cardGrid.root;
  results.append(cardGrid.scroll);
  const imports =
    store === null
      ? null
      : localImportControls({
          store,
          target: body,
          enabled: () => storageState === 'ready',
          manage: () => {
            memory.tab = 'installed';
            render();
          },
          changed: async (entryId) => {
            memory.tab = 'installed';
            memory.selectedId = entryId;
            await reloadInstalled();
            options.onInstalledChanged?.();
          },
        });
  const installedView = installedPane(ctx, {
    pick: (record) => void pickMap(record.mapId, record.entryId),
    rebuild: (entryId) => imports?.rebuild(entryId),
  });
  const detail = catalogueDetail(ctx, api, (author) => filters.update({ author }));
  main.append(results, installedView.root, detail.root);
  const importTools = node('div', 'catalogue__import-tools');
  importTools.hidden = true;
  body.append(filters.root, importTools);
  if (imports !== null) body.append(imports.root);
  body.append(storageNotice, main);

  /** A line in the grid's place, with the one button that can change it. */
  const notice = (line: string, action: { label: string; run: () => void } | null): HTMLElement => {
    const box = node('div', 'catalogue__notice');
    box.append(node('p', 'catalogue__notice-line', line));
    if (action !== null) {
      const button = node('button', 'main-menu__ghost', action.label);
      button.type = 'button';
      button.addEventListener('click', action.run);
      box.append(button);
    }
    return box;
  };

  function loadingNotice(): HTMLElement {
    const box = notice(text.loading, null);
    box.classList.add('catalogue__notice--loading');
    box.setAttribute('role', 'status');
    const spinner = node('span', 'catalogue__spinner');
    spinner.setAttribute('aria-hidden', 'true');
    box.prepend(spinner);
    return box;
  }

  function paintTabs(groups: readonly InstalledGroup[]): void {
    const updates = groups.filter(isUpdate).length;
    for (const [tab, button] of tabButtons) {
      const active = tab === memory.tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
      if (tab === 'browse') {
        button.textContent = text.tabs.browse;
        continue;
      }
      button.replaceChildren(
        hasInstalledSnapshot
          ? formatMessage(text.tabs.installed, { count: installedMapRows(groups).length })
          : text.storage.installed,
      );
      button.removeAttribute('title');
      if (updates > 0) {
        button.title = formatMessage(text.tabUpdatesTitle, { count: updates });
        button.append(node('span', 'catalogue__tab-updates', formatCount(updates)));
      }
    }
    filters.root.hidden = memory.tab !== 'browse';
    importTools.hidden = imports === null || memory.tab === 'browse';
    if (imports !== null) {
      const target = memory.tab === 'browse' ? filters.trailing : importTools;
      if (imports.pickers.parentElement !== target) target.append(imports.pickers);
    }
    results.hidden = memory.tab !== 'browse';
    installedView.root.hidden = memory.tab !== 'installed' || !hasInstalledSnapshot;
  }

  /** Keeps the selection while it is among `ids`, else moves it to the first of them. */
  function keepSelection(ids: readonly string[]): void {
    if (memory.selectedId === null || !ids.includes(memory.selectedId)) memory.selectedId = ids[0] ?? null;
  }

  function paintDetail(emptyLine: string | null): void {
    const row = memory.selectedId === null ? undefined : rowOf(memory.selectedId);
    const id = row?.entry.id ?? null;
    details.select(id);
    detail.root.hidden = memory.tab === 'installed' && row === undefined;
    if (row === undefined) detail.clear(emptyLine);
    else detail.show(row, isInstalled(row.entry.id), details.get(row.entry.id), details.error(row.entry.id));
  }

  function renderGrid(): void {
    cardGrid.clear();
    detail.root.hidden = false;
    grid.setAttribute('aria-busy', String(failure === null && entries === null));
    if (failure !== null || entries === null) {
      count.textContent = '';
      grid.replaceChildren(
        failure !== null
          ? notice(text.unreachable, { label: text.retry, run: () => void loadCatalogue() })
          : loadingNotice(),
      );
      paintDetail(null);
      return;
    }
    const shown = queryRows(rows, memory.query, compareLabels());
    const filtered = hasActiveFilters(memory.query) || memory.query.text.trim() !== '';
    count.textContent = filtered
      ? formatMessage(text.countFiltered, {
          shown: formatCount(shown.length),
          total: formatCount(rows.length),
        })
      : formatMessage(text.countLine, {
          maps: formatMessage(pluralForm(rows.length, text.entries, bcp47Tag()), { count: rows.length }),
        });
    keepSelection(shown.map((row) => row.entry.id));
    if (shown.length === 0) {
      grid.replaceChildren(
        rows.length === 0
          ? notice(text.empty, null)
          : notice(
              text.noMatch,
              hasActiveFilters(memory.query) ? { label: text.resetFilters, run: filters.reset } : null,
            ),
      );
      paintDetail(text.panelEmpty);
      return;
    }
    const sort = memory.query.sort;
    const dateOf: CardDate = sort === 'updated' ? 'updated' : sort === 'newest' ? 'published' : null;
    cardGrid.paint(shown, memory.selectedId, dateOf);
    paintDetail(text.panelEmpty);
  }

  function renderInstalled(groups: readonly InstalledGroup[]): void {
    if (hasInstalledSnapshot) keepSelection(groups.map((group) => group.entryId));
    installedView.paint(groups, memory.selectedId);
    paintDetail(text.panelEmpty);
  }

  /** The tabs and the open tab's content and panel, after any change to the rows, query or tab. */
  function render(): void {
    main.inert = storageState !== 'ready';
    main.setAttribute('aria-busy', String(storageState === 'loading'));
    storageNotice.hidden = storageState === 'ready';
    storageNotice.setAttribute('role', storageState === 'error' ? 'alert' : 'status');
    storageNotice.replaceChildren(
      ...(storageState === 'ready'
        ? []
        : [
            notice(
              storageState === 'error'
                ? hasInstalledSnapshot
                  ? text.storage.failedPrevious
                  : text.storage.failed
                : text.storage.loading,
              storageState === 'error' ? { label: text.retry, run: () => void reloadInstalled() } : null,
            ),
          ]),
    );
    if (imports !== null) {
      imports.pickers.inert = storageState !== 'ready';
      if (storageState !== 'ready') imports.closeMenu();
    }
    const groups = installedGroups(installed, rows, localSources);
    paintTabs(groups);
    if (memory.tab === 'browse') renderGrid();
    else {
      cardGrid.clear();
      renderInstalled(groups);
    }
  }

  function select(entryId: string): void {
    details.select(entryId, true);
    memory.selectedId = entryId;
    cardGrid.select(entryId);
    paintDetail(text.panelEmpty);
    if (memory.tab === 'installed')
      installedView.paint(installedGroups(installed, rows, localSources), memory.selectedId);
  }

  /** Rows and every view over them again, after the catalogue or the installed maps changed. */
  function refreshAll(): void {
    rows = entries === null ? [] : catalogueRows(entries, installed, IR_VERSION, shipped);
    filters.setRows(rows);
    render();
  }

  /** One entry's progress, panel and Installed row again, while it downloads. */
  function refreshEntry(entryId: string): void {
    const row = rowOf(entryId);
    if (row === undefined) return;
    cardGrid.paintProgress(entryId);
    if (detail.shownId === entryId)
      detail.show(row, isInstalled(entryId), details.get(entryId), details.error(entryId));
    if (memory.tab === 'installed')
      installedView.paint(installedGroups(installed, rows, localSources), memory.selectedId);
  }
  async function pick(row: CatalogueRow): Promise<void> {
    if (row.playableMapId === null) return;
    await pickMap(row.playableMapId, row.entry.id);
  }

  async function pickMap(mapId: string, entryId: string): Promise<void> {
    if (storageState !== 'ready') return;
    const source = await findMapSource(mapId);
    if (scope.signal.aborted || storageState !== 'ready') return;
    if (source === null || source.stale) {
      failures.set(entryId, text.mapMissing);
      void reloadInstalled();
      return;
    }
    options.onPick(mapSourceItem(source, api));
  }

  function startDownload(row: CatalogueRow): void {
    if (store === null || storageState !== 'ready' || downloads.has(row.entry.id)) return;
    const id = row.entry.id;
    downloads.set(id, 0);
    failures.delete(id);
    refreshEntry(id);
    void fetchCatalogEntry(api, id, fetch, scope.signal)
      .then((entry) => {
        if (entry === null) throw new Error(text.mapMissing);
        details.set(entry);
        return installCatalogEntry(entry, {
          api,
          store,
          signal: scope.signal,
          onProgress: ({ done, total }) => {
            downloads.set(id, total === 0 ? 1 : done / total);
            refreshEntry(id);
          },
        });
      })
      .catch((error: unknown) => {
        if (!scope.signal.aborted) failures.set(id, errorText(error));
      })
      .finally(() => {
        downloads.delete(id);
        if (scope.signal.aborted) return;
        void reloadInstalled().then(() => options.onInstalledChanged?.());
      });
  }

  async function removeInstall(entryId: string): Promise<void> {
    if (store === null || storageState !== 'ready') return;
    if (localSources.some((source) => source.entryId === entryId)) {
      const copy = text.localImport;
      const accepted = await menuConfirm(body, {
        title: copy.removeTitle,
        message: copy.removePrompt,
        confirm: copy.confirmRemove,
        cancel: copy.keep,
      });
      if (!accepted || scope.signal.aborted || storageState !== 'ready') return;
    }
    failures.delete(entryId);
    void store
      .remove(entryId)
      .catch((error: unknown) => failures.set(entryId, errorText(error)))
      .finally(() => {
        if (!scope.signal.aborted) void reloadInstalled().then(() => options.onInstalledChanged?.());
      });
  }

  async function reloadInstalled(): Promise<void> {
    const read = ++installedRead;
    storageState = 'loading';
    refreshAll();
    try {
      const snapshot = await Promise.all([store?.list() ?? [], store?.sources() ?? []]);
      if (scope.signal.aborted || read !== installedRead) return;
      [installed, localSources] = snapshot;
      hasInstalledSnapshot = true;
      storageState = 'ready';
    } catch {
      if (scope.signal.aborted || read !== installedRead) return;
      storageState = 'error';
    }
    refreshAll();
  }

  async function loadCatalogue(): Promise<void> {
    failure = null;
    entries = null;
    refreshAll();
    try {
      entries = await fetchCatalog(api, fetch, scope.signal);
    } catch (error) {
      failure = error;
    }
    if (!scope.signal.aborted) refreshAll();
  }

  render();
  void loadCatalogue();
  void reloadInstalled();
  void loadMapList()
    .then((maps) => {
      if (scope.signal.aborted) return;
      shipped = shippedMaps(maps);
      refreshAll();
    })
    .catch(() => {});

  return {
    tabs,
    count,
    body,
    dispose: () => {
      imports?.dispose();
      cardGrid.dispose();
      details.dispose();
      scope.abort();
    },
  };
}
