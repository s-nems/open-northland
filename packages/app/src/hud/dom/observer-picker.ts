import { playerSwatchHex } from '../../catalog/roster.js';
import type { ObserverSeatEntry } from '../../game/observer-seats.js';
import type { ViewerSeat } from '../../game/viewer-seat.js';
import { messages } from '../../i18n/index.js';
import { GLYPH } from './icons.js';

export interface ObserverPickerDeps {
  readonly seats: readonly ObserverSeatEntry[];
  /** What the picker shows as chosen; the choice itself goes through `onWatch`. */
  readonly viewer: ViewerSeat;
  /** Owner slot to team-colour slot for the swatches; absent = identity. */
  readonly playerColourOf?: ((player: number) => number) | undefined;
  readonly onWatch: (seat: number | null) => void;
}

/** The spectator's seat picker: one button naming the watched seat, over a list of the whole map and
 *  every seat it may watch. */
export interface ObserverPicker {
  readonly element: HTMLElement;
  /** Show the viewer's current choice; the same choice twice costs nothing. */
  refresh(): void;
  dispose(): void;
}

function swatch(colour: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'on-seat__swatch';
  span.style.background = colour;
  return span;
}

export function createObserverPicker(deps: ObserverPickerDeps): ObserverPicker {
  const copy = messages().hud;
  const root = document.createElement('div');
  root.className = 'on-resource on-picker';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'on-bar__count on-picker__button';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', copy.observer.label);
  const chosenSwatch = swatch('transparent');
  const chosenName = document.createElement('b');
  button.append(chosenSwatch, chosenName);
  button.insertAdjacentHTML('beforeend', GLYPH.down);

  const list = document.createElement('div');
  list.className = 'on-tip on-picker__list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', copy.observer.label);
  list.hidden = true;
  const title = document.createElement('h4');
  title.className = 'on-tip__title';
  title.textContent = copy.observer.label;
  list.append(title);

  // Seats are numbered from one, as the lobby numbers them. A name several seats share (a map's
  // "Duchy" ×6) carries the number too, so the rows stay distinguishable beyond their swatch.
  const seatNumber = (seat: number): number => seat + 1;
  const nameCount = new Map<string, number>();
  for (const { name } of deps.seats) {
    if (name !== undefined) nameCount.set(name, (nameCount.get(name) ?? 0) + 1);
  }
  const labelOf = (seat: number | null): string => {
    if (seat === null) return copy.observer.wholeMap;
    const name = deps.seats.find((s) => s.player === seat)?.name;
    if (name === undefined) return `${copy.player} ${seatNumber(seat)}`;
    return (nameCount.get(name) ?? 0) > 1 ? `${name} ${seatNumber(seat)}` : name;
  };
  const colourOf = (seat: number | null): string =>
    seat === null ? 'transparent' : playerSwatchHex(deps.playerColourOf?.(seat) ?? seat);

  const entries = new Map<number | null, HTMLButtonElement>();
  const entry = (seat: number | null): void => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'on-seat';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    if (seat !== null) option.append(swatch(colourOf(seat)));
    option.append(labelOf(seat));
    option.addEventListener('click', () => {
      show(false);
      deps.onWatch(seat);
    });
    entries.set(seat, option);
    list.append(option);
  };
  entry(null);
  for (const seat of deps.seats) entry(seat.player);

  // Escape closes the open list from wherever focus sits, since a clicked button holds no focus in
  // every browser; the tool panel's own Escape runs first, so an open window closes before the list.
  const onEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    show(false);
    button.focus();
    event.stopPropagation();
  };
  const show = (open: boolean): void => {
    if (list.hidden === !open) return;
    list.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) document.addEventListener('keydown', onEscape, true);
    else document.removeEventListener('keydown', onEscape, true);
  };
  button.addEventListener('click', () => show(list.hidden === true));
  // A press anywhere else closes the list; `focusout` alone would not, for the same reason.
  const onPressOutside = (event: PointerEvent): void => {
    if (!(event.target instanceof Node && root.contains(event.target))) show(false);
  };
  document.addEventListener('pointerdown', onPressOutside, true);
  root.append(button, list);

  let shown: number | null | undefined;
  return {
    element: root,
    refresh: () => {
      const seat = deps.viewer.seat();
      if (seat === shown) return;
      shown = seat;
      chosenName.textContent = labelOf(seat);
      chosenSwatch.style.background = colourOf(seat);
      chosenSwatch.hidden = seat === null;
      for (const [entrySeat, option] of entries) {
        option.setAttribute('aria-selected', String(entrySeat === seat));
      }
    },
    dispose: () => {
      show(false);
      document.removeEventListener('pointerdown', onPressOutside, true);
      root.remove();
    },
  };
}
