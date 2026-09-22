import type { UiString } from '../../content/gui-gfx.js';
import { diag } from '../../diag/index.js';
import { messages } from '../../i18n/index.js';
import type { GoodIconSource, PresentationPack } from '../../presentation/pack.js';
import { stockAmount } from '../details-panel/sections/building/shared.js';
import type { BuildingHoverState, HoverCardModel, HoverCardRow } from '../hover-card/model.js';
import { goodIconMarkup, goodIconSource, goodIconStyle } from './good-art.js';

/**
 * The parchment card the cursor opens over the world: a settler's name and trade, or a building's name,
 * construction state and store. It rides the DOM plane in design px and never takes pointer events, so
 * the press under it still reaches the map.
 */

/** Design px between the cursor and the card's near corner, so the card never covers what is pointed at. */
const CURSOR_GAP_PX = 16;
/** Design px kept between the card and the screen edges when it is pushed back inside. */
const EDGE_MARGIN_PX = 6;
/** Lines one column carries before the card opens another; three hold a warehouse's whole store. */
const ROWS_PER_COLUMN = 16;
const MAX_COLUMNS = 3;
/** The good icon on a row, matched to the card's small type rather than the summary bar's 25 px box. */
const ROW_ICON_PX = 13;

/** The `misc` rows naming a site's and an upgrade's state; the original prints them as "<state> (N%)". */
const STATE_STRING_ID: Readonly<Record<BuildingHoverState, number>> = { construction: 51, upgrade: 52 };

export interface HoverCardDeps {
  /** The DOM HUD plane; the card is placed on it in design px. */
  readonly plane: HTMLElement;
  /** The plane's current scale, which turns a client (CSS) point into a design-px one. */
  readonly scale: () => number;
  /** The pack the map draws with, or null for the original's art; the good icons follow it. */
  readonly pack: PresentationPack | null;
  readonly uiString: UiString;
}

export interface HoverCard {
  /** Show `model` beside a client (CSS) point. The caller holds one model object per tick, and the same
   *  object at the same point touches no DOM, so this runs every frame of a hover. */
  show(clientX: number, clientY: number, model: HoverCardModel): void;
  hide(): void;
  dispose(): void;
}

/** A drawn line, kept across ticks while the card lists the same goods; only the figure changes. */
interface DrawnRow {
  readonly key: string;
  readonly line: HTMLElement;
  readonly figure: HTMLElement;
}

/** What identifies a line across two ticks of the same store: its good, or a nameless one's label. */
function rowKey(row: HoverCardRow): string {
  return row.goodId ?? row.label;
}

/** The good rows the card lists: a store's, and none at all for a settler. */
function rowsOf(model: HoverCardModel): readonly HoverCardRow[] {
  return model.kind === 'building' ? model.rows : [];
}

export function createHoverCard(deps: HoverCardDeps): HoverCard {
  // Per card, not per module: the icon a good resolves to follows the pack this game draws with, and a
  // menu-to-game swap builds a new card in the same document.
  const iconSources = new Map<string, Promise<GoodIconSource | null>>();
  const paintIcon = (frame: HTMLElement, goodId: string): void => {
    let pending = iconSources.get(goodId);
    if (pending === undefined) {
      pending = goodIconSource(goodId, deps.pack);
      iconSources.set(goodId, pending);
    }
    pending
      .then((source) => {
        if (source !== null && frame.isConnected) frame.style.cssText = goodIconStyle(source, ROW_ICON_PX);
      })
      .catch((error: unknown) => diag.warn('hud', `hover card icon ${goodId}: ${String(error)}`));
  };

  const rowElement = (row: HoverCardRow): DrawnRow => {
    const line = document.createElement('p');
    line.className = 'on-tip__row';
    const name = document.createElement('span');
    if (row.goodId !== undefined) name.innerHTML = goodIconMarkup(ROW_ICON_PX);
    name.append(row.label);
    const figure = document.createElement('b');
    line.append(name, figure);
    const frame = name.querySelector('.on-good__frame');
    if (row.goodId !== undefined && frame instanceof HTMLElement) paintIcon(frame, row.goodId);
    return { key: rowKey(row), line, figure };
  };

  const element = document.createElement('aside');
  element.className = 'on-tip on-hovercard';
  element.setAttribute('role', 'tooltip');
  element.hidden = true;
  element.innerHTML =
    '<h4 class="on-tip__title"></h4><p class="on-hovercard__caption"></p><div class="on-hovercard__rows"></div>';
  const title = element.querySelector('.on-tip__title');
  const caption = element.querySelector('.on-hovercard__caption');
  const rows = element.querySelector('.on-hovercard__rows');
  if (
    !(title instanceof HTMLElement) ||
    !(caption instanceof HTMLElement) ||
    !(rows instanceof HTMLElement)
  ) {
    throw new Error('hover card: template incomplete');
  }
  deps.plane.append(element);

  /** The model drawn now: the caller's per-tick object, so identity is the cheap unchanged test. */
  let drawn: HoverCardModel | null = null;
  let drawnRows: DrawnRow[] = [];
  /** The card's own design-px box and where it stands, so a resting cursor writes no style. */
  let box = { w: 0, h: 0 };
  let placed = '';
  /** The design-px screen. It follows the window and the HUD scale, never the frame. */
  let screen = { w: 0, h: 0, scale: Number.NaN };
  const measureScreen = (): void => {
    screen = { w: deps.plane.clientWidth, h: deps.plane.clientHeight, scale: deps.scale() };
  };
  window.addEventListener('resize', measureScreen);

  const fillRows = (model: HoverCardModel): void => {
    const modelRows = rowsOf(model);
    const same =
      drawnRows.length === modelRows.length && modelRows.every((row, i) => drawnRows[i]?.key === rowKey(row));
    if (!same) {
      drawnRows = modelRows.map(rowElement);
      const columns = Math.min(MAX_COLUMNS, Math.max(1, Math.ceil(drawnRows.length / ROWS_PER_COLUMN)));
      rows.style.setProperty('--rows', `${Math.ceil(drawnRows.length / columns)}`);
      rows.replaceChildren(...drawnRows.map((drawnRow) => drawnRow.line));
    }
    // Outside the rebuild: a settler's card lists nothing, and its grid would still hold a line's gap.
    rows.hidden = modelRows.length === 0;
    // A working store changes its amounts every tick; its lines and their icons stay.
    modelRows.forEach((row, i) => {
      const figure = drawnRows[i]?.figure;
      const amount = stockAmount(row.amount, row.needed);
      if (figure !== undefined && figure.textContent !== amount) figure.textContent = amount;
    });
  };

  /** The second line: a settler's trade, or how far a site or an upgrade has come. */
  const captionOf = (model: HoverCardModel): string | null => {
    if (model.kind === 'settler') return model.profession;
    if (model.state === null) return null;
    const fallback = messages().hud.hoverCard[model.state.kind];
    const label = deps.uiString('misc', STATE_STRING_ID[model.state.kind], fallback);
    return `${label} (${model.state.pct}%)`;
  };

  const fill = (model: HoverCardModel): boolean => {
    if (model === drawn) return false;
    drawn = model;
    // A settler is a name and a trade, which stand side by side rather than stacked.
    element.classList.toggle('on-hovercard--brief', model.kind === 'settler');
    title.textContent = model.title;
    const line = captionOf(model);
    caption.hidden = line === null;
    if (line !== null) caption.textContent = line;
    fillRows(model);
    return true;
  };

  return {
    show(clientX, clientY, model): void {
      const changed = fill(model);
      element.hidden = false;
      // Measured after the fill and the reveal, so the box is the one actually being shown. A figure
      // that grew a digit widens the card, so this follows the content rather than the first show.
      if (changed) box = { w: element.offsetWidth, h: element.offsetHeight };
      // The plane's client box is the design-px screen; the pointer arrives in client px.
      const scale = deps.scale();
      if (scale !== screen.scale) measureScreen();
      const x = clientX / scale;
      const y = clientY / scale;
      // Below-right of the cursor, flipped to the other side when that corner would run off screen.
      const flipX = x + CURSOR_GAP_PX + box.w + EDGE_MARGIN_PX > screen.w;
      const flipY = y + CURSOR_GAP_PX + box.h + EDGE_MARGIN_PX > screen.h;
      const left = clamp(flipX ? x - CURSOR_GAP_PX - box.w : x + CURSOR_GAP_PX, screen.w - box.w);
      const top = clamp(flipY ? y - CURSOR_GAP_PX - box.h : y + CURSOR_GAP_PX, screen.h - box.h);
      const at = `${left},${top}`;
      if (at === placed) return;
      placed = at;
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
    },
    hide(): void {
      if (element.hidden) return;
      element.hidden = true;
    },
    dispose(): void {
      window.removeEventListener('resize', measureScreen);
      element.remove();
    },
  };
}

/** Between the card's edge and the screen's, never past the opposite edge on a card that barely fits. */
function clamp(value: number, max: number): number {
  return Math.max(EDGE_MARGIN_PX, Math.min(value, max - EDGE_MARGIN_PX));
}
