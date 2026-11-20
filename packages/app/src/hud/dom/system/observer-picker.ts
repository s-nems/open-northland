import type { ObserverSeatEntry } from '../../../game/match/observer-seats.js';
import { withComputerLevel, withSeatNick } from '../../../game/match/seat-names.js';
import { PLAYERS_SIGHT, type ViewerSeat, type WatchTarget } from '../../../game/viewer-seat.js';
import { messages } from '../../../i18n/index.js';
import { teamSwatchHex } from '../../../view/accessibility/team-colour.js';
import { type KeyBindings, keyDisplayLabel } from '../../keybindings.js';
import { watchActionOf } from '../../spectator-keys.js';
import { GLYPH } from '../icons.js';

export interface ObserverPickerDeps {
  readonly enabled?: () => boolean;
  readonly seats: readonly ObserverSeatEntry[];
  /** The nick of the person sitting a seat now; absent outside a relayed game. */
  readonly nickOf?: ((player: number) => string | undefined) | undefined;
  /** What the picker shows as chosen; the choice itself goes through `onWatch`. */
  readonly viewer: ViewerSeat;
  /** Owner slot to team-colour slot for the swatches; absent = identity. */
  readonly playerColourOf?: ((player: number) => number) | undefined;
  readonly onWatch: (target: WatchTarget) => void;
  /** The spectator keys each entry shows; absent, the list names no key. */
  readonly bindings?: KeyBindings | undefined;
}

/** The spectator's seat picker: one button naming the watched seat, over a list of the whole map
 *  (uncovered or under the players' sight, shown by icon alone and named on hover) and every seat
 *  it may watch. */
export interface ObserverPicker {
  readonly element: HTMLElement;
  /** Show the viewer's current choice; the same choice twice costs nothing. */
  refresh(): void;
  dispose(): void;
}

/** A seat's name as the spectator's HUD shows it. Seats are numbered from one, as the lobby numbers
 *  them; a name several seats share (a map's "Duchy" ×6) carries the number too, so the seats stay
 *  distinguishable beyond their swatch. The nick of the person sitting a seat leads its name, and a
 *  computer's seat carries its level. */
export function observerSeatLabels(
  seats: readonly ObserverSeatEntry[],
  nickOf?: (player: number) => string | undefined,
): (seat: number) => string {
  const copy = messages().hud;
  const seatNumber = (seat: number): number => seat + 1;
  const nameCount = new Map<string, number>();
  for (const { name } of seats) {
    if (name !== undefined) nameCount.set(name, (nameCount.get(name) ?? 0) + 1);
  }
  const numbered = (seat: number, name: string | undefined): string => {
    if (name === undefined) return `${copy.player} ${seatNumber(seat)}`;
    return (nameCount.get(name) ?? 0) > 1 ? `${name} ${seatNumber(seat)}` : name;
  };
  return (seat) => {
    const entry = seats.find((s) => s.player === seat);
    const label = numbered(seat, entry?.name);
    const nick = nickOf?.(seat);
    if (nick !== undefined) return withSeatNick(nick, label);
    return entry?.level === undefined ? label : withComputerLevel(label, entry.level);
  };
}

/** A seat's swatch colour, through the owner-to-team-colour map when one is given. */
export function observerSeatColour(seat: number, playerColourOf?: (player: number) => number): string {
  return teamSwatchHex(playerColourOf?.(seat) ?? seat);
}

function keycap(label: string): HTMLElement {
  const key = document.createElement('kbd');
  key.className = 'on-key';
  // The option's own label names it; a key read into the name would run into it ("Player 11").
  key.setAttribute('aria-hidden', 'true');
  key.textContent = label;
  return key;
}

/** The mark a view without a seat leads with in place of a seat's swatch. */
function modeMark(target: typeof PLAYERS_SIGHT | null): string {
  return target === PLAYERS_SIGHT ? GLYPH.eye : GLYPH.map;
}

function modeGlyph(target: typeof PLAYERS_SIGHT | null): HTMLElement {
  const span = document.createElement('span');
  span.className = 'on-picker__mode';
  span.innerHTML = modeMark(target);
  return span;
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
  root.hidden = deps.enabled?.() === false;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'on-bar__count on-picker__button';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-label', copy.observer.label);
  const chosenSwatch = swatch('transparent');
  const chosenMode = modeGlyph(null);
  const chosenName = document.createElement('b');
  button.append(chosenSwatch, chosenMode, chosenName);
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

  const seatLabel = observerSeatLabels(deps.seats, deps.nickOf);
  const labelOf = (seat: WatchTarget): string => {
    if (seat === null) return copy.observer.wholeMap;
    if (seat === PLAYERS_SIGHT) return copy.observer.playersSight;
    return seatLabel(seat);
  };
  const colourOf = (seat: WatchTarget): string =>
    typeof seat !== 'number' ? 'transparent' : observerSeatColour(seat, deps.playerColourOf);

  const seatOrder = deps.seats.map((seat) => seat.player);
  const keyOf = (seat: WatchTarget): string | null => {
    const action = watchActionOf(seat, seatOrder);
    const binding = action === null ? null : (deps.bindings?.[action] ?? null);
    return binding === null ? null : keyDisplayLabel(binding);
  };

  const entries = new Map<WatchTarget, HTMLButtonElement>();
  const entryKeys = new Map<WatchTarget, HTMLElement>();
  const seatNames = new Map<number, HTMLElement>();
  const entry = (seat: WatchTarget, parent: HTMLElement): void => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'on-seat';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    option.setAttribute('aria-label', labelOf(seat));
    if (typeof seat === 'number') {
      const name = document.createElement('span');
      name.className = 'on-seat__name';
      name.textContent = labelOf(seat);
      seatNames.set(seat, name);
      option.append(swatch(colourOf(seat)), name);
    } else {
      option.classList.add('on-seat--mode');
      option.title = labelOf(seat);
      option.append(modeGlyph(seat));
    }
    const key = keycap('');
    entryKeys.set(seat, key);
    option.append(key);
    option.addEventListener('click', () => {
      show(false);
      deps.onWatch(seat);
    });
    entries.set(seat, option);
    parent.append(option);
  };
  const modes = document.createElement('div');
  modes.className = 'on-picker__modes';
  list.append(modes);
  entry(PLAYERS_SIGHT, modes);
  entry(null, modes);
  for (const seat of deps.seats) entry(seat.player, list);
  // Read on every open, since the bindings object is rebound in place from the settings and a seat's
  // nick follows who sits in it.
  const showKeysAndNames = (): void => {
    for (const [seat, key] of entryKeys) {
      const label = keyOf(seat);
      key.hidden = label === null;
      key.textContent = label ?? '';
    }
    for (const [seat, name] of seatNames) {
      const label = labelOf(seat);
      if (name.textContent === label) continue;
      name.textContent = label;
      entries.get(seat)?.setAttribute('aria-label', label);
    }
  };

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
    if (open) showKeysAndNames();
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

  let shown: WatchTarget | undefined;
  let shownNick: string | undefined;
  return {
    element: root,
    refresh: () => {
      root.hidden = deps.enabled?.() === false;
      const seat = watchedOf(deps.viewer);
      const watchesSeat = typeof seat === 'number';
      const nick = watchesSeat ? deps.nickOf?.(seat) : undefined;
      if (seat === shown && nick === shownNick) return;
      shown = seat;
      shownNick = nick;
      chosenName.textContent = watchesSeat ? labelOf(seat) : '';
      chosenName.hidden = !watchesSeat;
      button.title = watchesSeat ? '' : labelOf(seat);
      chosenSwatch.style.background = colourOf(seat);
      chosenSwatch.hidden = !watchesSeat;
      chosenMode.hidden = watchesSeat;
      if (!watchesSeat) chosenMode.innerHTML = modeMark(seat);
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

function watchedOf(viewer: ViewerSeat): WatchTarget {
  return viewer.seat() ?? (viewer.sharedSight() ? PLAYERS_SIGHT : null);
}
