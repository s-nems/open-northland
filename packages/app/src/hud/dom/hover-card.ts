import type { UiString } from '../../content/gui-gfx.js';
import { messages } from '../../i18n/index.js';
import type { PresentationPack } from '../../presentation/pack.js';
import { stockAmount } from '../details-panel/sections/building/shared.js';
import type {
  BuildingHoverModel,
  BuildingHoverState,
  HoverCardModel,
  HoverCardRow,
  HoverOwner,
} from '../hover-card/model.js';
import { diplomacyStanceText, playerLabel } from '../tool-panel/diplomacy/model.js';
import { createGoodIconPainter, goodIconMarkup } from './good-art.js';
import { setClass, setHidden, write } from './parts/dom.js';
import { createMeterRow } from './parts/meter-row.js';

/**
 * The parchment card the cursor opens over the world: a settler's name and trade, or a building's name,
 * construction state and store; another seat's adds its owner, and a building its health. It rides the DOM plane in
 * design px and never takes pointer events, so the press under it still reaches the map.
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
   *  object at the same point touches no DOM, so this runs every frame of a hover. A new object that
   *  reads the same writes nothing and measures nothing either. */
  show(clientX: number, clientY: number, model: HoverCardModel): void;
  hide(): void;
  /** The model on the card while it shows, else null. */
  showing(): HoverCardModel | null;
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
  // Per card, not per module: the icon a good resolves to follows the pack this game draws with.
  const paintIcon = createGoodIconPainter(deps.pack);

  const rowElement = (row: HoverCardRow): DrawnRow => {
    const line = document.createElement('p');
    line.className = 'on-tip__row';
    const name = document.createElement('span');
    if (row.goodId !== undefined) name.innerHTML = goodIconMarkup(ROW_ICON_PX);
    name.append(row.label);
    const figure = document.createElement('b');
    line.append(name, figure);
    const frame = name.querySelector('.on-good__frame');
    if (row.goodId !== undefined && frame instanceof HTMLElement) paintIcon(frame, row.goodId, ROW_ICON_PX);
    return { key: rowKey(row), line, figure };
  };

  const element = document.createElement('aside');
  element.className = 'on-tip on-hovercard';
  element.setAttribute('role', 'tooltip');
  element.hidden = true;
  element.innerHTML =
    '<h4 class="on-tip__title"></h4><p class="on-hovercard__caption"></p>' +
    '<p class="on-hovercard__owner"><i class="on-hovercard__swatch"></i><span></span></p>' +
    '<div class="on-hovercard__rows"></div>';
  const title = element.querySelector('.on-tip__title');
  const caption = element.querySelector('.on-hovercard__caption');
  const owner = element.querySelector('.on-hovercard__owner');
  const swatch = element.querySelector('.on-hovercard__swatch');
  const ownerName = element.querySelector('.on-hovercard__owner > span');
  const rows = element.querySelector('.on-hovercard__rows');
  if (
    !(title instanceof HTMLElement) ||
    !(caption instanceof HTMLElement) ||
    !(owner instanceof HTMLElement) ||
    !(swatch instanceof HTMLElement) ||
    !(ownerName instanceof HTMLElement) ||
    !(rows instanceof HTMLElement)
  ) {
    throw new Error('hover card: template incomplete');
  }
  const health = createMeterRow();
  health.element.classList.add('on-hovercard__health');
  owner.after(health.element);
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

  /** True when a line was drawn anew or a figure changed. */
  const fillRows = (model: HoverCardModel): boolean => {
    const modelRows = rowsOf(model);
    const same =
      drawnRows.length === modelRows.length && modelRows.every((row, i) => drawnRows[i]?.key === rowKey(row));
    let changed = !same;
    if (!same) {
      drawnRows = modelRows.map(rowElement);
      const columns = Math.min(MAX_COLUMNS, Math.max(1, Math.ceil(drawnRows.length / ROWS_PER_COLUMN)));
      rows.style.setProperty('--rows', `${Math.ceil(drawnRows.length / columns)}`);
      rows.replaceChildren(...drawnRows.map((drawnRow) => drawnRow.line));
    }
    // Outside the rebuild: a settler's card lists nothing, and its grid would still hold a line's gap.
    changed = setHidden(rows, modelRows.length === 0) || changed;
    // A working store changes its amounts every tick; its lines and their icons stay.
    modelRows.forEach((row, i) => {
      const figure = drawnRows[i]?.figure;
      if (figure !== undefined) changed = write(figure, stockAmount(row.amount, row.needed)) || changed;
    });
    return changed;
  };

  /** The second line: a settler's trade, or how far a site or an upgrade has come. */
  const captionOf = (model: HoverCardModel): string | null => {
    if (model.kind === 'settler') return model.profession;
    if (model.state === null) return null;
    const fallback = messages().hud.hoverCard[model.state.kind];
    const label = deps.uiString('misc', STATE_STRING_ID[model.state.kind], fallback);
    return `${label} (${model.state.pct}%)`;
  };

  /** The owner's name and, when the game tells one, the viewer's stance toward it. */
  const ownerLine = (seat: HoverOwner): string => {
    const name = playerLabel(deps.uiString, seat.player, seat.name);
    return seat.stance === null ? name : `${name} · ${diplomacyStanceText(deps.uiString, seat.stance)}`;
  };

  /** True when the card's words or lines changed, so its box is measured again. */
  const fill = (model: HoverCardModel): boolean => {
    if (model === drawn) return false;
    drawn = model;
    // A settler is a name and a trade, which stand side by side rather than stacked; another seat's
    // person puts its owner on a line of its own under them.
    let changed = setClass(element, 'on-hovercard--brief', model.kind === 'settler');
    changed = write(title, model.title) || changed;
    const line = captionOf(model);
    changed = setHidden(caption, line === null) || changed;
    if (line !== null) changed = write(caption, line) || changed;
    changed = setHidden(owner, model.owner === null) || changed;
    if (model.owner !== null) {
      changed = write(ownerName, ownerLine(model.owner)) || changed;
      swatch.style.background = model.owner.colour;
    }
    const bar = model.kind === 'building' ? model.health : null;
    changed = setHidden(health.element, bar === null) || changed;
    // The meter's width is fixed by its grid, so a new figure never changes the card's box.
    if (bar !== null) health.update({ label: bar.label, pct: bar.pct, tooltip: bar.hover });
    return fillRows(model) || changed;
  };

  return {
    show(clientX, clientY, model): void {
      const revealed = setHidden(element, false);
      const changed = fill(model) || revealed;
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
      setHidden(element, true);
    },
    showing: () => (element.hidden ? null : drawn),
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

/**
 * A link naming a house that shows the house's card while the cursor rests on it. Pointer events place
 * the card; each tick's `update` gives it the house's fresh model at the last point, since a resting
 * cursor sends no event. A changed or dropped house takes the card with it: a relabelled link reports
 * no leave.
 */
export interface HouseCardLink {
  /** The cursor over the link naming `house` (its event), or off it (null). */
  hover(house: number | null, event: Pick<MouseEvent, 'clientX' | 'clientY'> | null): void;
  /** A tick: the link names `house` now. */
  update(house: number | null): void;
}

/** `modelOf` returns one object per house and snapshot, so a move over the link only repositions. */
export function createHouseCardLink(
  card: HoverCard,
  modelOf: (house: number) => BuildingHoverModel | null,
): HouseCardLink {
  let carded: number | null = null;
  let shown: HoverCardModel | null = null;
  let at = { x: 0, y: 0 };
  const forget = (): void => {
    carded = null;
    shown = null;
  };
  const drop = (): void => {
    // Only this link's card: another link may have taken the shared card since.
    if (carded !== null && card.showing() === shown) card.hide();
    forget();
  };
  const put = (house: number): void => {
    const model = modelOf(house);
    if (model === null) {
      drop();
      return;
    }
    carded = house;
    shown = model;
    card.show(at.x, at.y, model);
  };
  return {
    hover(house, event): void {
      if (house === null || event === null) {
        drop();
        return;
      }
      at = { x: event.clientX, y: event.clientY };
      put(house);
    },
    update(house): void {
      if (carded === null) return;
      // Hidden by its owner (the panel or the window closed) or taken by another link.
      if (card.showing() !== shown) forget();
      else if (house !== carded) drop();
      else put(house);
    },
  };
}
