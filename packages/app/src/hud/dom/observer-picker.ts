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

  const labelOf = (seat: number | null): string =>
    seat === null
      ? copy.observer.wholeMap
      : (deps.seats.find((s) => s.player === seat)?.name ?? `${copy.player} ${seat}`);
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

  const show = (open: boolean): void => {
    if (list.hidden === !open) return;
    list.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };
  button.addEventListener('click', () => show(list.hidden === true));
  // A press anywhere else closes the list; `focusout` alone would not, since a button takes no focus
  // on click in every browser.
  const onPressOutside = (event: PointerEvent): void => {
    if (!(event.target instanceof Node && root.contains(event.target))) show(false);
  };
  document.addEventListener('pointerdown', onPressOutside, true);
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !list.hidden) {
      show(false);
      button.focus();
      event.stopPropagation();
    }
  });
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
      document.removeEventListener('pointerdown', onPressOutside, true);
      root.remove();
    },
  };
}
