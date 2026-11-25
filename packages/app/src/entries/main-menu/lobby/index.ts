import { isMultiplayerMapType } from '@open-northland/data';
import { mapOreYield } from '../../../game/match/session-rules.js';
import { drawSessionSeed } from '../../../game/match/session-url.js';
import { messages } from '../../../i18n/index.js';
import type { LaunchEntry } from '../../../launch.js';
import { targetSearch } from '../../../view/target-search.js';
import { mapItemLineup, seatStanceReader } from '../lineup/model.js';
import { lineupRoster, lineupTitle, relationLine } from '../lineup/view.js';
import { mapModeToggles } from '../lobby-controls/mode.js';
import { menuMapTextReader } from '../map-text.js';
import { createMapDetailsCard } from '../map-select/card.js';
import type { MapSelectItem } from '../map-select/model.js';
import type { MenuScreen, MountedScreen } from '../model.js';
import { screenHead } from '../screen-head.js';
import { localSeatElements } from './local-seats.js';
import {
  initialLobbyState,
  lobbySlotRows,
  lobbyStartEntry,
  localLobbyOptions,
  oreYieldAcrossMaps,
} from './model.js';
import { lobbyOptionsCard } from './options-card.js';
import {
  claimSeat,
  hasClaimableSeat,
  OBSERVER_SEAT,
  type RosterState,
  type SeatChoice,
  setSlotColor,
  setSlotDifficulty,
  setSlotTribe,
  setVacantMode,
} from './roster-state.js';

/** The lobby of `item`, a base map whose modes it offers as switches; the chosen mode or the base is the
 *  played map the roster, the details card and the launch read. */
export function lobbyScreen(
  item: MapSelectItem,
  open: (screen: MenuScreen) => void,
  rosters: Map<string, RosterState>,
  launch: LaunchEntry,
): MountedScreen {
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
  const tribeHead = document.createElement('span');
  tribeHead.textContent = lobby.tribe;
  const controlHead = document.createElement('span');
  controlHead.textContent = lobby.controlHeader;
  const difficultyHead = document.createElement('span');
  cols.append(
    document.createElement('span'),
    slotHead,
    tribeHead,
    controlHead,
    difficultyHead,
    document.createElement('span'),
  );
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
  let played = item;
  let refreshTranslated = (): void => undefined;
  const mapText = menuMapTextReader(() => refreshTranslated());
  const tribeLabel = (tribe: number): string => mapText.tribeName(tribe);

  const side = document.createElement('aside');
  side.className = 'main-menu__lobby-side';
  const card = createMapDetailsCard({ translateText: mapText.text, tribeName: tribeLabel });
  card.show(item);

  const launchPanel = document.createElement('div');
  launchPanel.className = 'main-menu__lobby-launch';

  const search = new URLSearchParams(window.location.search);
  const options = localLobbyOptions(search, item.types);
  // The player's own ore richness, given back when a mode that brings its own is turned off.
  let ownOreYield = options.oreYield;
  options.oreYield ??= mapOreYield(item.roomDefaults);
  let players = played.players;
  let lineup = mapItemLineup(played, players);
  let stance = seatStanceReader(played.relations);
  // A mode is a map of its own with its own seats, so each keeps its own roster.
  const rosterKey = (): string => played.id;

  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'main-menu__primary main-menu__lobby-start';
  start.textContent = lobby.start;
  const modeToggles = mapModeToggles(item, null, (mode) => {
    const next = mode ?? item;
    const ore = oreYieldAcrossMaps(played, next, { oreYield: options.oreYield, own: ownOreYield });
    options.oreYield = ore.oreYield;
    ownOreYield = ore.own;
    played = next;
    optionsCard.paint();
    card.show(played);
    players = played.players;
    lineup = mapItemLineup(played, players);
    stance = seatStanceReader(played.relations);
    pickerSlot = null;
    update(rosters.get(rosterKey()) ?? initialLobbyState(players));
  });
  const optionsCard = lobbyOptionsCard(options, isMultiplayerMapType(item.types), {
    modes: modeToggles,
    standardOreYield: () => mapOreYield(played.roomDefaults),
  });
  launchPanel.append(optionsCard.element, start);
  side.append(card.root, launchPanel);

  body.append(main, side);
  section.append(head, body);

  // Roster state is kept per map and mode, so a switch and back keeps the seats.
  let state = rosters.get(rosterKey()) ?? initialLobbyState(players);
  rosters.set(rosterKey(), state);
  let pickerSlot: number | null = null;
  /** Focus key restored after the next re-render when the focused control goes away. */
  let refocus: string | null = null;

  const gateStart = (): void => {
    const gated = hasClaimableSeat(players) && state.seat === null;
    start.disabled = gated;
    start.title = gated ? lobby.startNeedsSeat : '';
  };
  const update = (next: RosterState): void => {
    state = next;
    rosters.set(rosterKey(), next);
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
    const focused = document.activeElement;
    const key = refocus ?? (focused instanceof HTMLElement ? (focused.dataset.focus ?? null) : null);
    refocus = null;
    const seats = localSeatElements(played, state, pickerSlot, {
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
      setMode(player, mode) {
        update(setVacantMode(state, player, mode));
      },
      pickTribe(player, tribe) {
        update(setSlotTribe(state, player, tribe));
      },
      pickDifficulty(player, difficulty) {
        update(setSlotDifficulty(state, player, difficulty));
      },
      claim(player) {
        pickerSlot = null;
        refocus = `chip:${player}`;
        update(claimSeat(state, player));
      },
    }, tribeLabel, mapText.text);
    const rows: HTMLElement[] = [];
    const slotRows = lobbySlotRows(players, state);
    const byPlayer = new Map(slotRows.map((row) => [row.slot.player, row]));
    const listed = slotRows.map((row) => ({ player: row.slot.player, color: row.colorId }));
    const parts = lineupRoster(
      lineup,
      listed.map((seat) => seat.player),
    );
    for (const part of parts) {
      if (part.kind === 'title') {
        rows.push(lineupTitle(part));
        continue;
      }
      const row = byPlayer.get(part.player);
      if (row === undefined) continue;
      rows.push(seats.row(row, part.ownRelations ? relationLine(part.player, listed, stance) : null));
      if (pickerSlot === part.player) rows.push(seats.picker(row));
    }
    // The level column is headed only while some seat plays at one.
    difficultyHead.textContent = slotRows.some((row) => row.difficulty !== null)
      ? lobby.difficultyHeader
      : '';
    list.replaceChildren(...rows);
    watchList.replaceChildren(
      watchRow(OBSERVER_SEAT, lobby.observerName, lobby.observerDetail, lobby.observerTaken),
    );
    if (key !== null) {
      const again = section.querySelector<HTMLElement>(`[data-focus="${key}"]`);
      if (again !== null && !(again instanceof HTMLButtonElement && again.disabled)) again.focus();
    }
  };
  refreshTranslated = () => {
    card.show(played);
    renderSeats();
  };
  renderSeats();
  gateStart();

  // Capture phase: Esc closes an open colour picker before the menu shell reads it as
  // back-navigation. A window open over the seats takes its own Esc.
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.target instanceof Element && event.target.closest('[aria-modal="true"]') !== null) return;
    if (event.key === 'Escape' && pickerSlot !== null) {
      event.stopPropagation();
      refocus = `chip:${pickerSlot}`;
      pickerSlot = null;
      renderSeats();
    }
  };
  window.addEventListener('keydown', onKeydown, true);

  start.addEventListener('click', () => {
    if (!start.disabled)
      launch(targetSearch(lobbyStartEntry(played.id, state, players, options, drawSessionSeed())));
  });

  return {
    element: section,
    dispose: () => {
      window.removeEventListener('keydown', onKeydown, true);
      optionsCard.dispose();
      mapText.dispose();
    },
  };
}
