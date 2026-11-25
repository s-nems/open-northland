import { LANGUAGES } from '@open-northland/data';
import { playerSwatchHex } from '../../../catalog/roster.js';
import type { LocalizedMapString } from '../../../game/map/strings.js';
import { GLYPH } from '../../../hud/dom/icons.js';
import {
  bcp47Tag,
  formatMessage,
  isLocale,
  tribeName as localizedTribeName,
  messages,
  pluralForm,
} from '../../../i18n/index.js';
import type { TranslateChoice } from '../../../i18n/translate/mission-translate.js';
import { segControl } from '../../../view/settings/controls.js';
import { mapItemLineup } from '../lineup/model.js';
import { lineupLabel } from '../lineup/view.js';
import {
  defaultMapPreview,
  type MapPreviewView,
  type MapSelectItem,
  mapCategory,
  mapPreviewUrl,
  mapPreviewViews,
} from './model.js';

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
  dispose(): void;
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

/** The row/card meta line: category name, plus the number of listed seats a person may take and
 *  a multiplayer map's lineup. */
export function metaLine(item: MapSelectItem): string {
  const select = messages().mainMenu.mapSelect;
  const category = select.categoryNames[mapCategory(item)];
  if (item.tutorialStep !== undefined)
    return `${category} · ${formatMessage(select.tutorialStep, { step: item.tutorialStep })}`;
  const seatable = item.players.filter((slot) => slot.claimable && !slot.hidden).length;
  if (seatable === 0) return category;
  const players = formatMessage(pluralForm(seatable, select.players, bcp47Tag()), { count: seatable });
  const lineup = mapItemLineup(item);
  return lineup === null ? `${category} · ${players}` : `${category} · ${players} · ${lineupLabel(lineup)}`;
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

function seatChip(tribeId: number, colorId: number, nameOfTribe: (tribe: number) => string): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'main-menu__seat-chip';
  const dot = document.createElement('span');
  dot.className = 'main-menu__seat-dot';
  dot.style.background = playerSwatchHex(colorId);
  const tribe = document.createElement('span');
  tribe.textContent = nameOfTribe(tribeId);
  chip.append(dot, tribe);
  return chip;
}

export interface MapDetailsCardOptions {
  readonly translateText?: (found: LocalizedMapString) => string;
  readonly tribeName?: (tribe: number) => string;
  readonly translateTarget?: () => TranslateChoice;
  readonly onTranslateTarget?: (choice: TranslateChoice) => void;
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
  const descriptionBlock = document.createElement('div');
  descriptionBlock.className = 'main-menu__map-desc-block';
  const descriptionTools = document.createElement('div');
  descriptionTools.className = 'main-menu__map-desc-tools';
  const translateButton = document.createElement('button');
  translateButton.type = 'button';
  translateButton.className = 'main-menu__map-translate';
  translateButton.innerHTML = GLYPH.translate;
  const translateLabel = messages().hud.missionBook.translate;
  translateButton.setAttribute('aria-label', translateLabel);
  translateButton.setAttribute('aria-haspopup', 'menu');
  translateButton.setAttribute('aria-expanded', 'false');
  const translateMenu = document.createElement('div');
  translateMenu.className = 'main-menu__map-translate-menu';
  translateMenu.setAttribute('role', 'menu');
  translateMenu.setAttribute('aria-label', translateLabel);
  translateMenu.hidden = true;
  const translateChoices: readonly TranslateChoice[] = ['auto', ...LANGUAGES, 'original'];
  for (const choice of translateChoices) {
    const label =
      choice === 'auto'
        ? messages().hud.missionBook.translateAuto
        : choice === 'original'
          ? messages().hud.missionBook.translateOriginal
          : messages().mainMenu.settings.languageNames[choice];
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'main-menu__map-translate-item';
    row.dataset.translateChoice = choice;
    row.setAttribute('role', 'menuitemradio');
    row.setAttribute('aria-checked', 'false');
    row.textContent = label;
    translateMenu.append(row);
  }
  descriptionTools.append(translateButton, translateMenu);
  const description = document.createElement('p');
  description.className = 'main-menu__map-desc';
  descriptionBlock.append(description);
  const actions = document.createElement('div');
  actions.className = 'main-menu__map-actions';
  details.append(name, meta, narration, seats, descriptionBlock, actions);
  // The book's place for the translate icon: the card's top-right corner, its menu opening over the
  // preview, so it stays in reach where a screen hides the description (the lobby).
  card.append(frame, details, descriptionTools);

  const hasTranslateControl =
    options.translateTarget !== undefined && options.onTranslateTarget !== undefined;
  let translateOutside: ((event: PointerEvent) => void) | null = null;
  const syncTranslateMenu = (): void => {
    const choice = options.translateTarget?.() ?? 'auto';
    for (const row of translateMenu.querySelectorAll<HTMLElement>('[data-translate-choice]')) {
      row.setAttribute('aria-checked', String(row.dataset.translateChoice === choice));
    }
  };
  const closeTranslateMenu = (): void => {
    translateMenu.hidden = true;
    translateButton.setAttribute('aria-expanded', 'false');
    if (translateOutside !== null) {
      document.removeEventListener('pointerdown', translateOutside, true);
      translateOutside = null;
    }
  };
  const openTranslateMenu = (): void => {
    syncTranslateMenu();
    translateMenu.hidden = false;
    translateButton.setAttribute('aria-expanded', 'true');
    translateOutside = (event) => {
      if (
        event.target instanceof Node &&
        (translateMenu.contains(event.target) || translateButton.contains(event.target))
      ) {
        return;
      }
      closeTranslateMenu();
    };
    document.addEventListener('pointerdown', translateOutside, true);
  };
  translateButton.hidden = !hasTranslateControl;
  descriptionTools.hidden = !hasTranslateControl;
  translateButton.addEventListener('click', () => {
    if (translateMenu.hidden) openTranslateMenu();
    else closeTranslateMenu();
  });
  translateMenu.addEventListener('click', (event) => {
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('[data-translate-choice]')
        : null;
    const choice = target?.dataset.translateChoice;
    if (choice === 'auto' || choice === 'original' || isLocale(choice)) {
      closeTranslateMenu();
      options.onTranslateTarget?.(choice);
    }
  });

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
        ...(showSeats
          ? item.seats.map((seat) =>
              seatChip(seat.tribeId, seat.colorId, options.tribeName ?? localizedTribeName),
            )
          : []),
      );
      seats.hidden = !showSeats;
      const hasDescription =
        item.descriptionText !== undefined
          ? item.descriptionText.text.trim() !== ''
          : (item.description ?? '').trim() !== '';
      description.textContent =
        item.descriptionText === undefined
          ? (item.description ?? '')
          : (options.translateText?.(item.descriptionText) ?? item.descriptionText.text);
      description.hidden = !hasDescription;
      const hasSeats = item.tutorialStep === undefined && item.seats.length > 0;
      translateButton.hidden = !hasTranslateControl || (!hasDescription && !hasSeats);
      descriptionTools.hidden = translateButton.hidden;
      descriptionBlock.hidden = !hasDescription;
      syncTranslateMenu();
      showPreview(item, defaultMapPreview(item));
    },
    hide() {
      closeTranslateMenu();
      card.hidden = true;
      shown = null;
      previewImg.hidden = true;
      previewImg.removeAttribute('src');
      frameLabel.textContent = '';
    },
    dispose() {
      closeTranslateMenu();
    },
  };
}
