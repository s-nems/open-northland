import { loadMapList } from '../../content/maps-index.js';
import { bcp47Tag, formatMessage, messages } from '../../i18n/index.js';
import { SCENES } from '../../scenes/index.js';
import { generatedMapPreview } from '../menu/map-preview.js';
import { targetSearch } from '../menu/settings.js';
import {
  filterItems,
  MAP_FILTERS,
  type MapFilter,
  type MapSelectItem,
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

type MapSelectCopy = ReturnType<typeof messages>['mainMenu']['mapSelect'];

/** The registered test scenes as list rows, titled from the active locale's scene metadata. */
function sceneRows(): readonly MapSelectItem[] {
  const sceneCopy = messages().scene;
  return SCENES.flatMap((scene) => {
    const metadata = sceneCopy[scene.id as keyof typeof sceneCopy];
    return metadata === undefined ? [] : [sceneItem(scene.id, metadata.title, metadata.summary)];
  });
}

/** The row/panel meta line: category name, plus the roster size when the map ships one. */
function metaLine(item: MapSelectItem, copy: MapSelectCopy): string {
  const category = copy.categoryNames[item.category];
  if (item.playerCount === 0) return category;
  const players = formatMessage(pluralForm(item.playerCount, copy.players, bcp47Tag()), {
    count: item.playerCount,
  });
  return `${category} · ${players}`;
}

export function mapSelectScreen(open: (screen: MenuScreen) => void): HTMLElement {
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
  for (const f of MAP_FILTERS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'main-menu__seg-btn';
    button.textContent = select.filters[f];
    button.addEventListener('click', () => {
      filter = f;
      for (const [key, b] of segButtons) b.classList.toggle('is-active', key === filter);
      renderList();
    });
    segButtons.set(f, button);
    seg.append(button);
  }
  tools.append(search, seg);
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
  listCol.append(listScroll, count);

  const previewCol = document.createElement('div');
  previewCol.className = 'main-menu__map-preview-col';
  const frame = document.createElement('div');
  frame.className = 'main-menu__map-preview';
  const previewImg = document.createElement('img');
  previewImg.alt = '';
  previewImg.hidden = true;
  const frameLabel = document.createElement('div');
  frameLabel.className = 'main-menu__map-preview-label';
  frame.append(previewImg, frameLabel);
  const info = document.createElement('div');
  info.className = 'main-menu__map-info';
  const details = document.createElement('div');
  details.className = 'main-menu__map-details';
  const name = document.createElement('div');
  name.className = 'main-menu__map-name';
  const meta = document.createElement('div');
  meta.className = 'main-menu__map-meta';
  const description = document.createElement('p');
  description.className = 'main-menu__map-desc';
  details.append(name, meta, description);
  const primary = document.createElement('button');
  primary.type = 'button';
  primary.className = 'main-menu__primary';
  primary.disabled = true;
  info.append(details, primary);
  previewCol.append(frame, info);

  body.append(listCol, previewCol);
  section.append(head, body);

  // Scenes are available immediately; decoded maps join when /maps-index answers.
  let items: readonly MapSelectItem[] = sceneRows();
  let filter: MapFilter = 'all';
  let selected: MapSelectItem | null = null;
  let mapsLoaded = false;
  let previewGeneration = 0;
  const rowButtons = new Map<MapSelectItem, HTMLButtonElement>();

  const showPreview = (item: MapSelectItem): void => {
    const generation = ++previewGeneration;
    previewImg.hidden = true;
    previewImg.removeAttribute('src');
    if (item.kind === 'scene') {
      frameLabel.textContent = select.noPreview;
      return;
    }
    frameLabel.textContent = '';
    const applyGenerated = (): void => {
      void generatedMapPreview(item.id).then((source) => {
        if (generation !== previewGeneration || source === null) return;
        previewImg.src = source;
        previewImg.hidden = false;
      });
    };
    if (item.minimap) {
      // The decoded minimap PNG when the pipeline emitted one; a broken file falls back to the
      // client-side rasterized preview (the `error` handler below).
      previewImg.src = `/maps/${encodeURIComponent(item.id)}.png`;
      previewImg.hidden = false;
    } else {
      applyGenerated();
    }
    previewImg.onerror = () => {
      if (generation !== previewGeneration) return;
      // One hop only: a failing generated blob must not re-enter this handler.
      previewImg.onerror = null;
      previewImg.hidden = true;
      applyGenerated();
    };
  };

  const selectItem = (item: MapSelectItem): void => {
    selected = item;
    for (const [rowItem, button] of rowButtons) {
      button.classList.toggle('is-selected', rowItem === item);
    }
    name.textContent = item.title;
    meta.textContent = metaLine(item, select);
    description.textContent = item.description ?? '';
    primary.disabled = false;
    primary.textContent = item.kind === 'map' ? select.next : select.run;
    showPreview(item);
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
      // A stale minimap flag degrades to the gradient placeholder, not a broken-image glyph.
      img.addEventListener('error', () => img.remove());
      thumb.append(img);
    }
    const text = document.createElement('div');
    text.className = 'main-menu__map-row-text';
    const rowName = document.createElement('div');
    rowName.className = 'main-menu__map-row-name';
    rowName.textContent = item.title;
    const rowMeta = document.createElement('div');
    rowMeta.className = 'main-menu__map-row-meta';
    rowMeta.textContent = item.kind === 'scene' ? (item.description ?? '') : metaLine(item, select);
    text.append(rowName, rowMeta);
    button.append(thumb, text);
    button.addEventListener('click', () => selectItem(item));
    return button;
  };

  const renderList = (): void => {
    const rows = filterItems(items, filter, search.value);
    // The scenes filter counts scenes; every other filter counts maps.
    const countForms = filter === 'scenes' ? select.scenes : select.maps;
    const mapsText = formatMessage(pluralForm(rows.length, countForms, bcp47Tag()), {
      count: rows.length,
    });
    count.textContent = formatMessage(select.countLine, { maps: mapsText });
    rowButtons.clear();
    if (rows.length === 0) {
      // Before /maps-index settles the list is merely not-yet-loaded, not absent; only a settled
      // empty result earns the "no decoded maps" explanation.
      if (mapsLoaded) {
        const empty = document.createElement('p');
        empty.className = 'main-menu__map-empty';
        empty.textContent = select.empty;
        list.replaceChildren(empty);
      } else {
        list.replaceChildren();
      }
      selected = null;
      name.textContent = '';
      meta.textContent = '';
      description.textContent = '';
      primary.disabled = true;
      primary.textContent = select.next;
      previewGeneration += 1;
      previewImg.hidden = true;
      frameLabel.textContent = '';
      return;
    }
    for (const item of rows) rowButtons.set(item, rowButton(item));
    list.replaceChildren(...rowButtons.values());
    const current = selected !== null && rows.includes(selected) ? selected : rows[0];
    if (current !== undefined) selectItem(current);
  };

  search.addEventListener('input', renderList);
  segButtons.get(filter)?.classList.add('is-active');
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
    open('lobby');
  });

  return section;
}
