import { apiBaseUrl, playableMapSources } from '../../content/map-source/index.js';
import { quietTextField } from '../../hud/dom/parts/text-field.js';
import { bcp47Tag, formatMessage, messages, pluralForm } from '../../i18n/index.js';
import { MAP_SCENES, SCENES } from '../../scenes/index.js';
import { createMapDetailsCard, metaLine, narratorBadge, paintMapThumb } from './map-card.js';
import {
  filterItems,
  listedIn,
  type MapContentTab,
  type MapFilter,
  type MapFilterTab,
  type MapListing,
  type MapSelectItem,
  type MapSelectMemory,
  mapSourceItem,
  sceneItem,
} from './map-select-model.js';

export interface MapPickerOptions {
  readonly memory: MapSelectMemory;
  readonly listing: MapListing;
  /** The filter bar offered; test scenes are listed only when their tab is among them. */
  readonly tabs: readonly MapFilterTab[];
  /** Maps kept out of the list altogether, such as those a room cannot seat anyone on. */
  readonly include?: (item: MapSelectItem) => boolean;
  readonly primaryLabel: (item: MapSelectItem) => string;
  readonly onPrimary: (item: MapSelectItem) => void;
  /** Called when the player switches between the map list (`null`) and a content tab; the owner
   *  shows that tab's body in place of `body`. Content tabs are disabled without it. */
  readonly onContent?: (tab: MapContentTab | null) => void;
  /** The decoded maps the listing takes, once `maps-index.json` has answered. */
  readonly onMaps?: (maps: readonly MapSelectItem[]) => void;
}

export interface MapPicker {
  /** The segmented filter bar, for the owner's header. */
  readonly tabs: HTMLElement;
  /** The searchable list column beside the details card; fills its owner's remaining height. */
  readonly body: HTMLElement;
  /** Highlights the row with this id when the current rows hold it. */
  select(id: string): void;
  /** Reads the map sources again, after the catalogue installed or removed a map. */
  reload(): void;
}

function sceneRows(): readonly MapSelectItem[] {
  const sceneCopy = messages().scene;
  return [...SCENES, ...MAP_SCENES].flatMap((scene) => {
    const metadata = sceneCopy[scene.id as keyof typeof sceneCopy];
    return metadata === undefined ? [] : [sceneItem(scene.id, metadata.title, metadata.summary)];
  });
}

/** The map list with search, filter tabs and the details card, shared by New Game and a room. */
export function mapPicker(options: MapPickerOptions): MapPicker {
  const { memory } = options;
  const copy = messages().mainMenu;
  const select = copy.mapSelect;

  const seg = document.createElement('div');
  seg.className = 'main-menu__seg';
  seg.hidden = options.tabs.length === 0;
  const segButtons = new Map<MapFilter, HTMLButtonElement>();
  const contentButtons = new Map<MapContentTab, HTMLButtonElement>();
  const switchContent = (next: MapContentTab | null): void => {
    const changed = memory.content !== next;
    memory.content = next;
    paintTabs();
    if (changed) options.onContent?.(next);
  };
  for (const tab of options.tabs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'main-menu__seg-btn';
    if (tab.kind === 'content') {
      button.textContent = select.filters[tab.id];
      if (options.onContent === undefined) button.disabled = true;
      else button.addEventListener('click', () => switchContent(tab.id));
      contentButtons.set(tab.id, button);
      seg.append(button);
      continue;
    }
    button.textContent = select.filters[tab.filter];
    button.addEventListener('click', () => {
      memory.filter = tab.filter;
      switchContent(null);
      renderList();
    });
    segButtons.set(tab.filter, button);
    seg.append(button);
  }
  const paintTab = (button: HTMLButtonElement, active: boolean): void => {
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  };
  const paintTabs = (): void => {
    for (const [key, b] of segButtons) paintTab(b, memory.content === null && key === memory.filter);
    for (const [key, b] of contentButtons) paintTab(b, key === memory.content);
  };

  const body = document.createElement('div');
  body.className = 'main-menu__map-body';
  const listCol = document.createElement('div');
  listCol.className = 'main-menu__map-list-col';
  const tutorialIntro = document.createElement('div');
  tutorialIntro.className = 'main-menu__tutorial-intro';
  tutorialIntro.hidden = true;
  const tutorialIntroTitle = document.createElement('strong');
  tutorialIntroTitle.textContent = select.tutorialIntroTitle;
  const tutorialIntroBody = document.createElement('span');
  tutorialIntroBody.textContent = select.tutorialIntroBody;
  tutorialIntro.append(tutorialIntroTitle, tutorialIntroBody);
  const search = document.createElement('input');
  search.type = 'search';
  quietTextField(search);
  search.className = 'main-menu__map-search';
  search.placeholder = select.searchPlaceholder;
  search.setAttribute('aria-label', select.searchPlaceholder);
  const listScroll = document.createElement('div');
  listScroll.className = 'main-menu__map-scroll';
  const list = document.createElement('div');
  list.className = 'main-menu__map-list';
  const fade = document.createElement('div');
  fade.className = 'main-menu__map-fade';
  listScroll.append(list, fade);
  const count = document.createElement('div');
  count.className = 'main-menu__map-count';
  listCol.append(tutorialIntro, search, listScroll, count);

  const previewCol = document.createElement('div');
  previewCol.className = 'main-menu__map-preview-col';
  const card = createMapDetailsCard();
  const primary = document.createElement('button');
  primary.type = 'button';
  primary.className = 'main-menu__primary';
  primary.disabled = true;
  card.actions.append(primary);
  previewCol.append(card.root);
  body.append(listCol, previewCol);

  // Scenes are available immediately; decoded maps join when maps-index.json answers.
  const scenes: readonly MapSelectItem[] = segButtons.has('scenes') ? sceneRows() : [];
  let items: readonly MapSelectItem[] = scenes;
  let selected: MapSelectItem | null = null;
  let mapsLoaded = false;
  const rowButtons = new Map<MapSelectItem, HTMLButtonElement>();

  const selectItem = (item: MapSelectItem): void => {
    selected = item;
    memory.selectedId = item.id;
    for (const [rowItem, button] of rowButtons) {
      button.classList.toggle('is-selected', rowItem === item);
      button.setAttribute('aria-pressed', String(rowItem === item));
      // Roving tabindex: the selected row is the list's only tab stop; arrows walk the rest.
      button.tabIndex = rowItem === item ? 0 : -1;
    }
    card.show(item);
    primary.disabled = false;
    primary.textContent = options.primaryLabel(item);
  };

  list.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const entries = [...rowButtons.entries()];
    const index = entries.findIndex(([item]) => item === selected);
    const next = entries[index + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next !== undefined) {
      selectItem(next[0]);
      next[1].focus();
    }
  });

  const rowButton = (item: MapSelectItem): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'main-menu__map-row';
    const thumb = document.createElement('div');
    thumb.className = 'main-menu__map-thumb';
    paintMapThumb(thumb, item);
    const text = document.createElement('div');
    text.className = 'main-menu__map-row-text';
    const rowName = document.createElement('div');
    rowName.className = 'main-menu__map-row-name';
    const rowTitle = document.createElement('span');
    rowTitle.className = 'main-menu__map-row-title';
    rowTitle.textContent = item.title;
    rowName.append(rowTitle);
    const narrator = narratorBadge(item);
    if (narrator !== null) rowName.append(narrator);
    if (item.tutorialStep === 1) {
      const recommended = document.createElement('span');
      recommended.className = 'main-menu__tutorial-start';
      recommended.textContent = select.tutorialRecommended;
      rowName.append(recommended);
    }
    const rowMeta = document.createElement('div');
    rowMeta.className = 'main-menu__map-row-meta';
    rowMeta.textContent = item.kind === 'scene' ? (item.description ?? '') : metaLine(item);
    text.append(rowName, rowMeta);
    button.append(thumb, text);
    button.addEventListener('click', () => selectItem(item));
    return button;
  };

  const paintFade = (): void => {
    fade.hidden = listScroll.scrollHeight <= listScroll.clientHeight;
  };
  // A detached first render measures 0/0; the observer fires once the column gets real layout.
  new ResizeObserver(paintFade).observe(listScroll);

  const renderList = (): void => {
    const rows = filterItems(items, options.listing, memory.filter, search.value);
    tutorialIntro.hidden = memory.filter !== 'tutorial';
    const countForms =
      memory.filter === 'scenes'
        ? select.scenes
        : memory.filter === 'tutorial'
          ? select.tutorials
          : select.maps;
    const mapsText = formatMessage(pluralForm(rows.length, countForms, bcp47Tag()), {
      count: rows.length,
    });
    count.textContent = formatMessage(
      memory.filter === 'tutorial' ? select.tutorialCountLine : select.countLine,
      { maps: mapsText },
    );
    rowButtons.clear();
    if (rows.length === 0) {
      // Only a settled empty result means "no decoded maps"; before that the list is still loading.
      const notice = document.createElement('p');
      notice.className = 'main-menu__map-empty';
      notice.textContent = mapsLoaded ? (items.length > 0 ? select.noMatch : select.empty) : select.loading;
      list.replaceChildren(notice);
      if (!mapsLoaded) count.textContent = '';
      selected = null;
      card.hide();
      primary.disabled = true;
      paintFade();
      return;
    }
    for (const item of rows) rowButtons.set(item, rowButton(item));
    list.replaceChildren(...rowButtons.values());
    // A re-entered screen restores the remembered selection by id (items are fresh objects).
    const current =
      selected !== null && rows.includes(selected)
        ? selected
        : (rows.find((row) => row.id === memory.selectedId) ?? rows[0]);
    if (current !== undefined) selectItem(current);
    paintFade();
  };

  search.value = memory.query;
  search.addEventListener('input', () => {
    memory.query = search.value;
    renderList();
  });
  paintTabs();
  renderList();
  let loads = 0;
  const loadMaps = (): void => {
    const load = ++loads;
    const api = apiBaseUrl();
    void playableMapSources().then((sources) => {
      // A navigation away detaches the list, and a newer load supersedes this one.
      if (!body.isConnected || load !== loads) return;
      mapsLoaded = true;
      const maps = sources
        .map((source) => mapSourceItem(source, api))
        .filter((item) => options.include?.(item) ?? true);
      items = [...maps, ...scenes];
      renderList();
      options.onMaps?.(maps.filter((item) => listedIn(item, options.listing)));
    });
  };
  loadMaps();

  primary.addEventListener('click', () => {
    if (selected !== null) options.onPrimary(selected);
  });

  return {
    tabs: seg,
    body,
    select(id) {
      for (const item of rowButtons.keys()) if (item.id === id) selectItem(item);
    },
    reload: loadMaps,
  };
}
