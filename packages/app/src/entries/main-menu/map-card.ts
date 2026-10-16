import { playerSwatchHex } from '../../catalog/roster.js';
import { bcp47Tag, formatMessage, messages, pluralForm, tribeName } from '../../i18n/index.js';
import { segControl } from '../../view/settings-controls.js';
import {
  defaultMapPreview,
  type MapPreviewView,
  type MapSelectItem,
  mapCategory,
  mapPreviewUrl,
  mapPreviewViews,
} from './map-select-model.js';

/**
 * The map details card shown by both map select and the lobby. The owning screen appends its own
 * controls into `actions`; an empty row collapses through CSS.
 */
export interface MapDetailsCard {
  /** Starts hidden until `show`. */
  readonly root: HTMLElement;
  /** The bottom actions row the owning screen fills. */
  readonly actions: HTMLElement;
  show(item: MapSelectItem): void;
  hide(): void;
}

/** Fills a row or room thumb with the map's default preview, or leaves it empty. */
export function paintMapThumb(thumb: HTMLElement, item: MapSelectItem): void {
  const view = defaultMapPreview(item);
  if (view === null) {
    thumb.replaceChildren();
    return;
  }
  const img = document.createElement('img');
  img.src = mapPreviewUrl(item, view);
  img.alt = '';
  img.loading = 'lazy';
  img.dataset.view = view;
  // A missing file leaves the thumb's gradient instead of a broken-image glyph.
  img.addEventListener('error', () => img.remove());
  thumb.replaceChildren(img);
}

/** The row/card meta line: category name, plus the roster size when the map ships one. */
export function metaLine(item: MapSelectItem): string {
  const select = messages().mainMenu.mapSelect;
  const category = select.categoryNames[mapCategory(item)];
  if (item.tutorialStep !== undefined)
    return `${category} · ${formatMessage(select.tutorialStep, { step: item.tutorialStep })}`;
  if (item.seats.length === 0) return category;
  const players = formatMessage(pluralForm(item.seats.length, select.players, bcp47Tag()), {
    count: item.seats.length,
  });
  return `${category} · ${players}`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** A rolled briefing scroll with sound waves leaving it. */
const NARRATOR_GLYPH_PATH =
  'M6 4h8v13a3 3 0 0 1-3 3H5a2 2 0 0 1-2-2v-1h8M6 4a2 2 0 0 0-2 2v9M8.5 8.5h3M8.5 12h3M17 9.5a3.5 3.5 0 0 1 0 5M19.5 7a7 7 0 0 1 0 10';

/** "Narrated briefing: <languages>" for a map whose briefing ships narration in any language, else null. */
export function narrationLabel(item: MapSelectItem): string | null {
  if (item.narration.length === 0) return null;
  const select = messages().mainMenu.mapSelect;
  const languages = item.narration.map((lang) => select.narratedLanguageNames[lang]).join(', ');
  return formatMessage(select.narrated, { languages });
}

function narratorGlyph(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('main-menu__narrator-glyph');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', NARRATOR_GLYPH_PATH);
  svg.append(path);
  return svg;
}

/** The row's narrator mark, named for a screen reader and on hover; null for an unnarrated map. */
export function narratorBadge(item: MapSelectItem): HTMLElement | null {
  const label = narrationLabel(item);
  if (label === null) return null;
  const badge = document.createElement('span');
  badge.className = 'main-menu__narrator-badge';
  badge.setAttribute('role', 'img');
  badge.setAttribute('aria-label', label);
  badge.title = label;
  badge.append(narratorGlyph());
  return badge;
}

function seatChip(tribeId: number, colorId: number): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'main-menu__seat-chip';
  const dot = document.createElement('span');
  dot.className = 'main-menu__seat-dot';
  dot.style.background = playerSwatchHex(colorId);
  const tribe = document.createElement('span');
  tribe.textContent = tribeName(tribeId);
  chip.append(dot, tribe);
  return chip;
}

export function createMapDetailsCard(): MapDetailsCard {
  const select = messages().mainMenu.mapSelect;

  const card = document.createElement('div');
  card.className = 'main-menu__map-card';
  card.hidden = true;
  const frame = document.createElement('div');
  frame.className = 'main-menu__map-preview';
  const previewImg = document.createElement('img');
  previewImg.alt = '';
  previewImg.hidden = true;
  const frameLabel = document.createElement('div');
  frameLabel.className = 'main-menu__map-preview-label';
  // A peek for the shown map only: every newly shown map opens on its default view again.
  let shown: MapSelectItem | null = null;
  const viewSwitch = segControl<MapPreviewView>(
    [
      { id: 'picture', label: select.previewViews.picture },
      { id: 'map', label: select.previewViews.map },
    ],
    'picture',
    (view) => {
      if (shown !== null) showPreview(shown, view);
    },
  );
  viewSwitch.root.classList.add('main-menu__map-preview-switch');
  viewSwitch.root.setAttribute('role', 'group');
  viewSwitch.root.setAttribute('aria-label', select.previewSwitch);
  frame.append(previewImg, frameLabel, viewSwitch.root);
  const details = document.createElement('div');
  details.className = 'main-menu__map-details';
  const name = document.createElement('div');
  name.className = 'main-menu__map-name';
  const meta = document.createElement('div');
  meta.className = 'main-menu__map-meta';
  const narration = document.createElement('div');
  narration.className = 'main-menu__map-narration';
  const narrationText = document.createElement('span');
  narration.append(narratorGlyph(), narrationText);
  const seats = document.createElement('div');
  seats.className = 'main-menu__map-seats';
  const description = document.createElement('p');
  description.className = 'main-menu__map-desc';
  const actions = document.createElement('div');
  actions.className = 'main-menu__map-actions';
  details.append(name, meta, narration, seats, description, actions);
  card.append(frame, details);

  // A missing file collapses to the empty frame instead of a broken-image glyph.
  previewImg.addEventListener('error', () => {
    previewImg.hidden = true;
  });

  const showPreview = (item: MapSelectItem, view: MapPreviewView | null): void => {
    shown = item;
    viewSwitch.root.hidden = mapPreviewViews(item).length < 2;
    if (view !== null) viewSwitch.setActive(view);
    frameLabel.textContent = item.kind === 'scene' ? select.noPreview : '';
    if (view === null) {
      previewImg.hidden = true;
      previewImg.removeAttribute('src');
      return;
    }
    previewImg.dataset.view = view;
    previewImg.src = mapPreviewUrl(item, view);
    previewImg.hidden = false;
  };

  return {
    root: card,
    actions,
    show(item) {
      card.hidden = false;
      name.textContent = item.title;
      meta.textContent = metaLine(item);
      const narrated = narrationLabel(item);
      narrationText.textContent = narrated ?? '';
      narration.hidden = narrated === null;
      const showSeats = item.tutorialStep === undefined && item.seats.length > 0;
      seats.replaceChildren(
        ...(showSeats ? item.seats.map((seat) => seatChip(seat.tribeId, seat.colorId)) : []),
      );
      seats.hidden = !showSeats;
      description.textContent = item.description ?? '';
      description.hidden = item.description === undefined || item.description === '';
      showPreview(item, defaultMapPreview(item));
    },
    hide() {
      card.hidden = true;
      shown = null;
      previewImg.hidden = true;
      previewImg.removeAttribute('src');
      frameLabel.textContent = '';
    },
  };
}
