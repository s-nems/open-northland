import { withBaseUrl } from '../../base-url.js';
import { loadMapList } from '../../content/maps-index.js';
import { bcp47Tag, formatMessage, messages } from '../../i18n/index.js';
import { SCENES } from '../../scenes/index.js';
import { createMapDetailsCard, metaLine } from './map-card.js';
import { generatedMapPreview } from './map-preview.js';
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
import { screenHead } from './screen-head.js';
import { targetSearch } from './target-search.js';

/** Maps continue to the lobby; a test scene starts directly, having no roster to negotiate. */

/** Rows rasterize their thumb this far before entering the viewport. */
const THUMB_PRELOAD_MARGIN = '200px';

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

  const head = screenHead('newGame', open);
  const tools = document.createElement('div');
  tools.className = 'main-menu__head-tools';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'main-menu__map-search';
  search.placeholder = select.searchPlaceholder;
  search.setAttribute('aria-label', select.searchPlaceholder);
  const seg = document.createElement('div');
  seg.className = 'main-menu__seg';
  const segButtons = new Map<MapFilter, HTMLButtonElement>();
  for (const tab of MAP_FILTER_TABS) {
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
  tools.append(seg);
  head.append(tools);

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

  // The details card is shared with the lobby; this screen contributes the primary action button.
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
    primary.textContent = item.kind === 'map' ? select.next : select.run;
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
      img.src = withBaseUrl(`/maps/${encodeURIComponent(item.id)}.png`);
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
    const rows = filterItems(items, memory.filter, search.value);
    const countForms = memory.filter === 'scenes' ? select.scenes : select.maps;
    const mapsText = formatMessage(pluralForm(rows.length, countForms, bcp47Tag()), {
      count: rows.length,
    });
    count.textContent = formatMessage(select.countLine, { maps: mapsText });
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
      // targetSearch carries the sticky menu params (lang, sound, ...).
      window.location.search = targetSearch(`?scene=${encodeURIComponent(selected.id)}`);
      return;
    }
    openLobby(selected);
  });

  return section;
}
