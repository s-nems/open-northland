import { loadMapList } from '../../content/maps-index.js';
import { bcp47Tag, formatMessage, messages } from '../../i18n/index.js';
import { SCENES } from '../../scenes/index.js';
import { generatedMapPreview } from '../menu/map-preview.js';
import { targetSearch } from '../menu/settings.js';
import { createMapDetailsCard, metaLine } from './map-card.js';
import {
  filterItems,
  MAP_FILTER_TABS,
  type MapFilter,
  type MapSelectItem,
  type MapSelectMemory,
  mapItem,
  pluralForm,
  sceneItem,
} from './map-select-model.js';
import type { MenuScreen } from './model.js';

/**
 * The map-select screen (design frame 4a): searchable, filterable list of decoded maps plus the
 * registered test scenes, a large preview, and the primary action. Maps continue to the lobby;
 * a test scene starts directly (scenes have no roster to negotiate).
 */

/** Rows rasterize their thumb this far before entering the viewport, so scrolling meets a ready
 *  image instead of a placeholder swap. */
const THUMB_PRELOAD_MARGIN = '200px';

/** The registered test scenes as list rows, titled from the active locale's scene metadata. */
function sceneRows(): readonly MapSelectItem[] {
  const sceneCopy = messages().scene;
  return SCENES.flatMap((scene) => {
    const metadata = sceneCopy[scene.id as keyof typeof sceneCopy];
    return metadata === undefined ? [] : [sceneItem(scene.id, metadata.title, metadata.summary)];
  });
}

export function mapSelectScreen(
  open: (screen: MenuScreen) => void,
  memory: MapSelectMemory,
  openLobby: (item: MapSelectItem) => void,
): HTMLElement {
  const copy = messages().mainMenu;
  const select = copy.mapSelect;

  const section = document.createElement('section');
  section.className = 'main-menu__screen main-menu__map-select';

  // Header row: back + title on the left baseline, search + segmented filter on the right.
  const head = document.createElement('div');
  head.className = 'main-menu__screen-head';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'main-menu__back';
  back.textContent = `← ${copy.back}`;
  back.addEventListener('click', () => open('main'));
  const title = document.createElement('h1');
  title.className = 'main-menu__screen-title';
  title.textContent = copy.screenTitles.newGame;
  const tools = document.createElement('div');
  tools.className = 'main-menu__head-tools';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'main-menu__map-search';
  search.placeholder = select.searchPlaceholder;
  const seg = document.createElement('div');
  seg.className = 'main-menu__seg';
  const segButtons = new Map<MapFilter, HTMLButtonElement>();
  for (const tab of MAP_FILTER_TABS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'main-menu__seg-btn';
    if (tab.kind === 'comingSoon') {
      // aria-disabled instead of `disabled`: a truly disabled button swallows hover, which kills
      // the native coming-soon tooltip in some engines.
      button.textContent = select.filters[tab.id];
      button.classList.add('is-coming-soon');
      button.title = select.comingSoonTip;
      button.setAttribute('aria-disabled', 'true');
      seg.append(button);
      continue;
    }
    button.textContent = select.filters[tab.filter];
    button.addEventListener('click', () => {
      memory.filter = tab.filter;
      for (const [key, b] of segButtons) b.classList.toggle('is-active', key === memory.filter);
      renderList();
    });
    segButtons.set(tab.filter, button);
    seg.append(button);
  }
  tools.append(seg);
  head.append(back, title, tools);

  // Body: the scrollable list column and the preview column.
  const body = document.createElement('div');
  body.className = 'main-menu__map-body';
  const listCol = document.createElement('div');
  listCol.className = 'main-menu__map-list-col';
  const listScroll = document.createElement('div');
  listScroll.className = 'main-menu__map-scroll';
  const list = document.createElement('div');
  list.className = 'main-menu__map-list';
  const fade = document.createElement('div');
  fade.className = 'main-menu__map-fade';
  listScroll.append(list, fade);
  const count = document.createElement('div');
  count.className = 'main-menu__map-count';
  listCol.append(search, listScroll, count);

  // The details card (shared with the lobby): this screen contributes the primary action button.
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
  section.append(head, body);

  // Scenes are available immediately; decoded maps join when /maps-index answers.
  let items: readonly MapSelectItem[] = sceneRows();
  let selected: MapSelectItem | null = null;
  let mapsLoaded = false;
  const rowButtons = new Map<MapSelectItem, HTMLButtonElement>();

  // Maps without a decoded PNG rasterize a thumb from map data, but only once their row nears the
  // viewport: each preview needs the full terrain JSON, so an eager pass over the list would pull
  // tens of megabytes. generatedMapPreview memoises, so the large preview reuses the same blob.
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
    }
    card.show(item);
    primary.disabled = false;
    primary.textContent = item.kind === 'map' ? select.next : select.run;
  };

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
      // A stale minimap flag falls back to the rasterized thumb; img.remove() keeps the gradient
      // placeholder (not a broken-image glyph) while that generates.
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
    const rowMeta = document.createElement('div');
    rowMeta.className = 'main-menu__map-row-meta';
    rowMeta.textContent = item.kind === 'scene' ? (item.description ?? '') : metaLine(item);
    text.append(rowName, rowMeta);
    button.append(thumb, text);
    button.addEventListener('click', () => selectItem(item));
    return button;
  };

  const renderList = (): void => {
    const rows = filterItems(items, memory.filter, search.value);
    // The scenes filter counts scenes; every other filter counts maps.
    const countForms = memory.filter === 'scenes' ? select.scenes : select.maps;
    const mapsText = formatMessage(pluralForm(rows.length, countForms, bcp47Tag()), {
      count: rows.length,
    });
    count.textContent = formatMessage(select.countLine, { maps: mapsText });
    rowButtons.clear();
    // The old rows leave the DOM with replaceChildren below; stop watching their thumbs.
    thumbObserver.disconnect();
    pendingThumbs.clear();
    if (rows.length === 0) {
      // Before /maps-index settles the list is merely not-yet-loaded, not absent; only a settled
      // empty result earns the "no decoded maps" explanation, and the wait states its purpose.
      const notice = document.createElement('p');
      notice.className = 'main-menu__map-empty';
      notice.textContent = mapsLoaded ? select.empty : select.loading;
      list.replaceChildren(notice);
      if (!mapsLoaded) count.textContent = '';
      selected = null;
      card.hide();
      primary.disabled = true;
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
  };

  search.value = memory.query;
  search.addEventListener('input', () => {
    memory.query = search.value;
    renderList();
  });
  segButtons.get(memory.filter)?.classList.add('is-active');
  renderList();
  void loadMapList().then((maps) => {
    // A navigation away detaches the screen; a late response must not rasterize previews for it.
    if (!section.isConnected) return;
    mapsLoaded = true;
    items = [...maps.map(mapItem), ...items];
    renderList();
  });

  primary.addEventListener('click', () => {
    if (selected === null) return;
    if (selected.kind === 'scene') {
      // Scenes start directly; targetSearch carries the sticky menu params (lang, sound, …).
      window.location.search = targetSearch(`?scene=${encodeURIComponent(selected.id)}`);
      return;
    }
    openLobby(selected);
  });

  return section;
}
