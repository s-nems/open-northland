import { loadMapList } from '../../content/maps-index.js';
import { bcp47Tag, formatMessage, messages } from '../../i18n/index.js';
import { MAP_SCENES, SCENES } from '../../scenes/index.js';
import { createMapDetailsCard, metaLine } from './map-card.js';
import { generatedMapPreview } from './map-preview.js';
import {
  filterItems,
  listedIn,
  type MapFilter,
  type MapFilterTab,
  type MapListing,
  type MapSelectItem,
  type MapSelectMemory,
  mapItem,
  pluralForm,
  sceneItem,
} from './map-select-model.js';

/** Rows rasterize their thumb this far before entering the viewport. */
const THUMB_PRELOAD_MARGIN = '200px';

export interface MapPickerOptions {
  readonly memory: MapSelectMemory;
  readonly listing: MapListing;
  /** The filter bar offered; test scenes are listed only when their tab is among them. */
  readonly tabs: readonly MapFilterTab[];
  /** Maps kept out of the list altogether, such as those a room cannot seat anyone on. */
  readonly include?: (item: MapSelectItem) => boolean;
  readonly primaryLabel: (item: MapSelectItem) => string;
  readonly onPrimary: (item: MapSelectItem) => void;
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
  for (const tab of options.tabs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'main-menu__seg-btn';
    if (tab.kind === 'comingSoon') {
      // aria-disabled instead of `disabled`: a disabled button swallows hover, which kills the
      // native tooltip in some engines.
      button.textContent = select.filters[tab.id];
      button.classList.add('is-coming-soon');
      button.title = copy.comingSoonTip;
      button.setAttribute('aria-disabled', 'true');
      seg.append(button);
      continue;
    }
    button.textContent = select.filters[tab.filter];
    button.addEventListener('click', () => {
      memory.filter = tab.filter;
      paintTabs();
      renderList();
    });
    segButtons.set(tab.filter, button);
    seg.append(button);
  }
  const paintTabs = (): void => {
    for (const [key, b] of segButtons) {
      b.classList.toggle('is-active', key === memory.filter);
      b.setAttribute('aria-pressed', String(key === memory.filter));
    }
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
  let items: readonly MapSelectItem[] = segButtons.has('scenes') ? sceneRows() : [];
  let selected: MapSelectItem | null = null;
  let mapsLoaded = false;
  const rowButtons = new Map<MapSelectItem, HTMLButtonElement>();

  // Maps without a decoded PNG rasterize a thumb only once their row nears the viewport: each
  // preview needs the full terrain JSON, so an eager pass would pull tens of megabytes.
  const pendingThumbs = new Map<Element, string>();
  const fillThumb = (thumb: Element, mapId: string): void => {
    void generatedMapPreview(mapId).then((source) => {
      if (source === null || !thumb.isConnected) return;
      const img = document.createElement('img');
      img.src = source;
      img.alt = '';
      thumb.replaceChildren(img);
    });
  };
  const thumbObserver = new IntersectionObserver(
    (observed) => {
      for (const entry of observed) {
        if (!entry.isIntersecting) continue;
        thumbObserver.unobserve(entry.target);
        const mapId = pendingThumbs.get(entry.target);
        pendingThumbs.delete(entry.target);
        if (mapId !== undefined) fillThumb(entry.target, mapId);
      }
    },
    { root: listScroll, rootMargin: THUMB_PRELOAD_MARGIN },
  );

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
    if (item.kind === 'map' && item.minimap) {
      const img = document.createElement('img');
      img.src = `/maps/${encodeURIComponent(item.id)}.png`;
      img.alt = '';
      img.loading = 'lazy';
      // A stale minimap flag falls back to the rasterized thumb; removing the img shows the
      // gradient placeholder instead of a broken-image glyph.
      img.addEventListener('error', () => {
        img.remove();
        fillThumb(thumb, item.id);
      });
      thumb.append(img);
    } else if (item.kind === 'map') {
      pendingThumbs.set(thumb, item.id);
      thumbObserver.observe(thumb);
    }
    const text = document.createElement('div');
    text.className = 'main-menu__map-row-text';
    const rowName = document.createElement('div');
    rowName.className = 'main-menu__map-row-name';
    rowName.textContent = item.title;
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
    // The old rows leave the DOM below, so stop watching their thumbs.
    thumbObserver.disconnect();
    pendingThumbs.clear();
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
  void loadMapList().then((entries) => {
    // A navigation away detaches the list; a late response must not rasterize previews for it.
    if (!body.isConnected) return;
    mapsLoaded = true;
    const maps = entries.map(mapItem).filter((item) => options.include?.(item) ?? true);
    items = [...maps, ...items];
    renderList();
    options.onMaps?.(maps.filter((item) => listedIn(item, options.listing)));
  });

  primary.addEventListener('click', () => {
    if (selected !== null) options.onPrimary(selected);
  });

  return {
    tabs: seg,
    body,
    select(id) {
      for (const item of rowButtons.keys()) if (item.id === id) selectItem(item);
    },
  };
}
