import { playerSwatchHex } from '../../catalog/roster.js';
import { bcp47Tag, formatMessage, messages, pluralForm, tribeName } from '../../i18n/index.js';
import { segControl } from '../../view/settings-controls.js';
import { type MapPreviewView, patchStoredSettings, readStoredSettings } from '../../view/settings-store.js';
import {
  type MapSelectItem,
  mapCategory,
  mapPreviewUrl,
  mapPreviewViews,
  shownMapPreview,
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

export interface MapDetailsCardOptions {
  /** The player switched between illustration and minimap; the choice is already stored. */
  readonly onPreviewView?: (view: MapPreviewView) => void;
}

/** Fills a row or room thumb with the preview the card would show for `item`, or leaves it empty. */
export function paintMapThumb(thumb: HTMLElement, item: MapSelectItem, preferred: MapPreviewView): void {
  const view = shownMapPreview(item, preferred);
  if (view === null) {
    thumb.replaceChildren();
    return;
  }
  const img = document.createElement('img');
  img.src = mapPreviewUrl(item.id, view);
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

export function createMapDetailsCard(options: MapDetailsCardOptions = {}): MapDetailsCard {
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
  let preferred = readStoredSettings().mapPreview;
  let shown: MapSelectItem | null = null;
  const viewSwitch = segControl<MapPreviewView>(
    [
      { id: 'picture', label: select.previewViews.picture },
      { id: 'map', label: select.previewViews.map },
    ],
    preferred,
    (view) => {
      preferred = view;
      patchStoredSettings({ mapPreview: view });
      if (shown !== null) showPreview(shown);
      options.onPreviewView?.(view);
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
  const seats = document.createElement('div');
  seats.className = 'main-menu__map-seats';
  const description = document.createElement('p');
  description.className = 'main-menu__map-desc';
  const actions = document.createElement('div');
  actions.className = 'main-menu__map-actions';
  details.append(name, meta, seats, description, actions);
  card.append(frame, details);

  // A missing file collapses to the empty frame instead of a broken-image glyph.
  previewImg.addEventListener('error', () => {
    previewImg.hidden = true;
  });

  const showPreview = (item: MapSelectItem): void => {
    shown = item;
    const view = shownMapPreview(item, preferred);
    viewSwitch.root.hidden = mapPreviewViews(item).length < 2;
    viewSwitch.setActive(view ?? preferred);
    frameLabel.textContent = item.kind === 'scene' ? select.noPreview : '';
    if (view === null) {
      previewImg.hidden = true;
      previewImg.removeAttribute('src');
      return;
    }
    previewImg.dataset.view = view;
    previewImg.src = mapPreviewUrl(item.id, view);
    previewImg.hidden = false;
  };

  return {
    root: card,
    actions,
    show(item) {
      card.hidden = false;
      name.textContent = item.title;
      meta.textContent = metaLine(item);
      const showSeats = item.tutorialStep === undefined && item.seats.length > 0;
      seats.replaceChildren(
        ...(showSeats ? item.seats.map((seat) => seatChip(seat.tribeId, seat.colorId)) : []),
      );
      seats.hidden = !showSeats;
      description.textContent = item.description ?? '';
      description.hidden = item.description === undefined || item.description === '';
      showPreview(item);
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
