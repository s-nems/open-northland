import { messages } from '../../../i18n/index.js';
import type { LaunchEntry } from '../../../launch.js';
import { createMapDetailsCard } from '../map-card.js';
import type { MapSelectItem } from '../map-select-model.js';
import type { MenuScreen } from '../model.js';
import { screenHead } from '../screen-head.js';
import { targetSearch } from '../target-search.js';
import { localSeatElements } from './local-seats.js';
import { initialLobbyOptions, initialLobbyState, lobbySlotRows, lobbyStartEntry } from './model.js';
import { lobbyOptionsCard } from './options-card.js';
import {
  claimSeat,
  hasClaimableSeat,
  OBSERVER_SEAT,
  OVERSEER_SEAT,
  type RosterState,
  type SeatChoice,
  setSlotColor,
  toggleVacantMode,
} from './roster-state.js';

/** Slots come from the map; none can be added or removed. */

export function lobbyScreen(
  item: MapSelectItem,
  open: (screen: MenuScreen) => void,
  rosters: Map<string, RosterState>,
  launch: LaunchEntry,
): HTMLElement {
  const copy = messages().mainMenu;
  const lobby = copy.lobby;

  const section = document.createElement('section');
  section.className = 'main-menu__screen main-menu__lobby';

  const head = screenHead('lobby', open);
  const kicker = document.createElement('div');
  kicker.className = 'main-menu__kicker';
  kicker.textContent = lobby.kicker;
  head.append(kicker);

  const body = document.createElement('div');
  body.className = 'main-menu__lobby-body';

  const main = document.createElement('div');
  main.className = 'main-menu__lobby-main';
  const cols = document.createElement('div');
  cols.className = 'main-menu__lobby-cols';
  const slotHead = document.createElement('span');
  slotHead.textContent = lobby.slotHeader;
  const controlHead = document.createElement('span');
  controlHead.textContent = lobby.controlHeader;
  cols.append(document.createElement('span'), slotHead, controlHead, document.createElement('span'));
  const list = document.createElement('div');
  list.className = 'main-menu__lobby-list';
  const footnote = document.createElement('div');
  footnote.className = 'main-menu__lobby-footnote';
  footnote.textContent = lobby.footnote;
  const watch = document.createElement('div');
  watch.className = 'main-menu__lobby-watch';
  const watchTitle = document.createElement('div');
  watchTitle.className = 'main-menu__lobby-watch-title';
  watchTitle.textContent = lobby.watchTitle;
  const watchList = document.createElement('div');
  watchList.className = 'main-menu__lobby-watch-list';
  watch.append(watchTitle, watchList);
  main.append(cols, list, footnote, watch);

  // Swapping the map goes through the header back button or Esc, so the card carries no actions here.
  const side = document.createElement('aside');
  side.className = 'main-menu__lobby-side';
  const card = createMapDetailsCard();
  card.show(item);

  const launchPanel = document.createElement('div');
  launchPanel.className = 'main-menu__lobby-launch';

  const options = initialLobbyOptions(new URLSearchParams(window.location.search));

  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'main-menu__primary main-menu__lobby-start';
  start.textContent = lobby.start;
  launchPanel.append(lobbyOptionsCard(options), start);
  side.append(card.root, launchPanel);

  body.append(main, side);
  section.append(head, body);

  // Roster state is kept per map, so a map switch and back keeps the seats.
  let state = rosters.get(item.id) ?? initialLobbyState(item.players);
  rosters.set(item.id, state);
  let pickerSlot: number | null = null;
  /** Focus key restored after the next re-render when the focused control goes away. */
  let refocus: string | null = null;

  const gateStart = (): void => {
    const gated = hasClaimableSeat(item.players) && state.seat === null;
    start.disabled = gated;
    start.title = gated ? lobby.startNeedsSeat : '';
  };
  const update = (next: RosterState): void => {
    state = next;
    rosters.set(item.id, next);
    renderSeats();
    gateStart();
  };

  const watchRow = (seat: SeatChoice, rowName: string, detail: string, taken: string): HTMLElement => {
    const active = state.seat === seat;
    const el = document.createElement('div');
    el.className = 'main-menu__watch-row';
    el.classList.toggle('is-active', active);
    const label = document.createElement('div');
    label.className = 'main-menu__lobby-label';
    const name = document.createElement('span');
    name.className = 'main-menu__watch-name';
    name.textContent = rowName;
    const sub = document.createElement('span');
    sub.className = 'main-menu__lobby-sub';
    sub.textContent = detail;
    label.append(name, sub);
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'main-menu__lobby-sit is-watch';
    pick.textContent = active ? taken : lobby.choose;
    pick.dataset.focus = `watch:${seat}`;
    pick.disabled = active;
    pick.addEventListener('click', () => {
      pickerSlot = null;
      update(claimSeat(state, seat));
    });
    el.append(label, pick);
    return el;
  };

  const renderSeats = (): void => {
    // replaceChildren drops keyboard focus to <body>, so focus returns to the rebuilt control
    // carrying the same data-focus key.
    const active = document.activeElement;
    const key = refocus ?? (active instanceof HTMLElement ? (active.dataset.focus ?? null) : null);
    refocus = null;
    const seats = localSeatElements(item, state, pickerSlot, {
      togglePicker(player) {
        pickerSlot = pickerSlot === player ? null : player;
        renderSeats();
      },
      pickColor(player, color) {
        const next = setSlotColor(state, player, color);
        pickerSlot = null;
        refocus = `chip:${player}`;
        if (next !== null) update(next);
        else renderSeats();
      },
      toggleMode(player) {
        update(toggleVacantMode(state, player));
      },
      claim(player) {
        pickerSlot = null;
        refocus = `chip:${player}`;
        update(claimSeat(state, player));
      },
    });
    const rows: HTMLElement[] = [];
    for (const row of lobbySlotRows(item.players, state)) {
      rows.push(seats.row(row));
      if (pickerSlot === row.slot.player) rows.push(seats.picker(row));
    }
    list.replaceChildren(...rows);
    watchList.replaceChildren(
      watchRow(OBSERVER_SEAT, lobby.observerName, lobby.observerDetail, lobby.observerTaken),
      watchRow(OVERSEER_SEAT, lobby.overseerName, lobby.overseerDetail, lobby.overseerTaken),
    );
    if (key !== null) {
      const again = section.querySelector<HTMLElement>(`[data-focus="${key}"]`);
      if (again !== null && !(again instanceof HTMLButtonElement && again.disabled)) again.focus();
    }
  };
  renderSeats();
  gateStart();

  // Capture phase: Esc closes an open colour picker before the menu shell reads it as
  // back-navigation.
  const onKeydown = (event: KeyboardEvent): void => {
    if (!section.isConnected) {
      unhookKeys();
      return;
    }
    if (event.key === 'Escape' && pickerSlot !== null) {
      event.stopPropagation();
      refocus = `chip:${pickerSlot}`;
      pickerSlot = null;
      renderSeats();
    }
  };
  const unhookKeys = (): void => window.removeEventListener('keydown', onKeydown, true);
  window.addEventListener('keydown', onKeydown, true);
  head.querySelector('.main-menu__back')?.addEventListener('click', unhookKeys);

  start.addEventListener('click', () => {
    if (start.disabled) return;
    unhookKeys();
    launch(targetSearch(lobbyStartEntry(item.id, state, item.players, options)));
  });

  return section;
}
