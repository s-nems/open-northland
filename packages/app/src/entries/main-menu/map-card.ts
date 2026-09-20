import { playerSwatchHex } from '../../catalog/roster.js';
import { bcp47Tag, formatMessage, messages, tribeName } from '../../i18n/index.js';
import { generatedMapPreview } from './map-preview.js';
import { type MapSelectItem, mapCategory, pluralForm } from './map-select-model.js';

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
  frame.append(previewImg, frameLabel);
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

  // Guards a stale async preview from painting over a newer selection.
  let previewGeneration = 0;

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
      // A broken decoded PNG falls back to the client-side rasterized preview.
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
      previewGeneration += 1;
      previewImg.hidden = true;
      frameLabel.textContent = '';
    },
  };
}
