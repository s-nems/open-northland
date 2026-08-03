import { MAP_PLAYER_COLOR_COUNT } from '@open-northland/data';
import { playerSwatchHex } from '../../../catalog/roster.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { targetSearch } from '../../menu/settings.js';
import { createMapDetailsCard } from '../map-card.js';
import type { MapSelectItem } from '../map-select-model.js';
import type { MenuScreen } from '../model.js';
import {
  initialLobbyOptions,
  initialLobbyState,
  LOBBY_FOG_MODES,
  type LobbySlotRow,
  lobbySlotRows,
  lobbyStartEntry,
} from './model.js';
import {
  claimSeat,
  hasClaimableSeat,
  OBSERVER_SEAT,
  OVERSEER_SEAT,
  type RosterState,
  type SeatChoice,
  setSlotColor,
  toggleVacantMode,
  wornByAnother,
} from './roster-state.js';

/**
 * The lobby screen (design frame 4b): the map's fixed slot list on the left (sit, recolour,
 * pre-set what a vacant seat does), the spectator modes below it, and the map card plus game
 * options and Start on the right. Slots come from the map; none can be added or removed.
 */

export function lobbyScreen(
  item: MapSelectItem,
  open: (screen: MenuScreen) => void,
  rosters: Map<string, RosterState>,
): HTMLElement {
  const copy = messages().mainMenu;
  const lobby = copy.lobby;

  const section = document.createElement('section');
  section.className = 'main-menu__screen main-menu__lobby';

  const head = document.createElement('div');
  head.className = 'main-menu__screen-head';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'main-menu__back';
  back.textContent = `← ${lobby.backLabel}`;
  back.addEventListener('click', () => open('newGame'));
  const title = document.createElement('h1');
  title.className = 'main-menu__screen-title';
  title.textContent = copy.screenTitles.lobby;
  const kicker = document.createElement('div');
  kicker.className = 'main-menu__kicker';
  kicker.textContent = lobby.kicker;
  head.append(back, title, kicker);

  const body = document.createElement('div');
  body.className = 'main-menu__lobby-body';

  // Left column: the slot table, its footnote, and the spectator modes.
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

  // Right column: the shared map card with a change-map link, then options and Start.
  const side = document.createElement('aside');
  side.className = 'main-menu__lobby-side';
  const card = createMapDetailsCard();
  const change = document.createElement('button');
  change.type = 'button';
  change.className = 'main-menu__link';
  change.textContent = lobby.changeMap;
  change.addEventListener('click', () => open('newGame'));
  card.actions.append(change);
  card.show(item);

  const launch = document.createElement('div');
  launch.className = 'main-menu__lobby-launch';
  const optionsCard = document.createElement('div');
  optionsCard.className = 'main-menu__lobby-card';
  const optionsTitle = document.createElement('div');
  optionsTitle.className = 'main-menu__lobby-card-title';
  optionsTitle.textContent = lobby.settingsTitle;
  optionsCard.append(optionsTitle);

  const options = initialLobbyOptions(new URLSearchParams(window.location.search));

  const fogLabel = document.createElement('div');
  fogLabel.className = 'main-menu__lobby-option-label';
  fogLabel.textContent = lobby.fogLabel;
  const fogSeg = document.createElement('div');
  fogSeg.className = 'main-menu__seg main-menu__lobby-fog';
  const fogButtons = new Map<string, HTMLButtonElement>();
  for (const mode of LOBBY_FOG_MODES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'main-menu__seg-btn';
    button.textContent = lobby.fogModes[mode].label;
    button.title = lobby.fogModes[mode].detail;
    button.classList.toggle('is-active', options.fog === mode);
    button.addEventListener('click', () => {
      options.fog = mode;
      for (const [key, b] of fogButtons) b.classList.toggle('is-active', key === mode);
    });
    fogButtons.set(mode, button);
    fogSeg.append(button);
  }
  optionsCard.append(fogLabel, fogSeg);

  const progressionRow = document.createElement('div');
  progressionRow.className = 'main-menu__lobby-option-row';
  const progressionLabel = document.createElement('span');
  progressionLabel.textContent = lobby.progressionLabel;
  const progressionToggle = document.createElement('button');
  progressionToggle.type = 'button';
  progressionToggle.className = 'main-menu__toggle';
  progressionToggle.setAttribute('role', 'switch');
  const paintProgression = (): void => {
    progressionToggle.classList.toggle('is-on', options.professionProgression);
    progressionToggle.setAttribute('aria-checked', String(options.professionProgression));
    progressionToggle.title = lobby.progressionModes[options.professionProgression ? 'on' : 'off'];
  };
  paintProgression();
  progressionToggle.addEventListener('click', () => {
    options.professionProgression = !options.professionProgression;
    paintProgression();
  });
  progressionRow.append(progressionLabel, progressionToggle);
  optionsCard.append(progressionRow);

  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'main-menu__primary main-menu__lobby-start';
  start.textContent = lobby.start;
  launch.append(optionsCard, start);
  side.append(card.root, launch);

  body.append(main, side);
  section.append(head, body);

  // Session roster state per map: a lobby round trip (or a map switch and back) keeps the seats.
  let state = rosters.get(item.id) ?? initialLobbyState(item.players);
  rosters.set(item.id, state);
  /** The slot whose colour picker strip is open, or null. */
  let pickerSlot: number | null = null;

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

  const chipButton = (row: LobbySlotRow): HTMLButtonElement => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'main-menu__lobby-chip';
    chip.style.background = playerSwatchHex(row.colorId);
    chip.textContent = String(row.slot.player + 1);
    const colourName = messages().animation.playerColors[row.colorId] ?? String(row.colorId);
    chip.title = item.fixedColors
      ? `${lobby.teamColour}: ${colourName} (${lobby.teamColourLocked})`
      : `${lobby.teamColour}: ${colourName}`;
    chip.setAttribute('aria-label', chip.title);
    chip.disabled = item.fixedColors;
    chip.setAttribute('aria-expanded', String(pickerSlot === row.slot.player));
    chip.addEventListener('click', () => {
      pickerSlot = pickerSlot === row.slot.player ? null : row.slot.player;
      renderSeats();
    });
    return chip;
  };

  const pickerStrip = (row: LobbySlotRow): HTMLElement => {
    const strip = document.createElement('div');
    strip.className = 'main-menu__lobby-picker';
    for (let colorId = 0; colorId < MAP_PLAYER_COLOR_COUNT; colorId++) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'main-menu__lobby-swatch';
      option.style.background = playerSwatchHex(colorId);
      const colourName = messages().animation.playerColors[colorId] ?? String(colorId);
      option.title = `${lobby.teamColour}: ${colourName}`;
      option.disabled = colorId !== row.colorId && wornByAnother(state, row.slot.player, colorId);
      option.classList.toggle('is-current', colorId === row.colorId);
      option.addEventListener('click', () => {
        const next = setSlotColor(state, row.slot.player, colorId);
        pickerSlot = null;
        if (next !== null) update(next);
        else renderSeats();
      });
      strip.append(option);
    }
    return strip;
  };

  const controlCell = (row: LobbySlotRow): HTMLElement => {
    if (row.kind === 'yours') {
      const cell = document.createElement('div');
      cell.className = 'main-menu__lobby-human';
      cell.textContent = lobby.human;
      return cell;
    }
    if (row.kind === 'scenario') {
      const cell = document.createElement('div');
      cell.className = 'main-menu__lobby-locked';
      cell.textContent = lobby.scenarioControl;
      return cell;
    }
    if (!row.slot.aiAllowed) {
      // No AI offer for this seat (`playeroption` Human/Closed-only): vacant means idle, no choice.
      const cell = document.createElement('div');
      cell.className = 'main-menu__lobby-locked';
      cell.textContent = lobby.vacantIdle;
      return cell;
    }
    const seg = document.createElement('div');
    seg.className = 'main-menu__seg main-menu__lobby-vacant';
    seg.title = lobby.vacantToggleTitle;
    const modes = [
      { mode: 'ai', label: lobby.vacantComputer },
      { mode: 'idle', label: lobby.vacantIdle },
    ] as const;
    for (const { mode, label } of modes) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'main-menu__seg-btn';
      button.textContent = label;
      button.classList.toggle('is-active', row.vacantMode === mode);
      button.addEventListener('click', () => {
        if (row.vacantMode !== mode) update(toggleVacantMode(state, row.slot.player));
      });
      seg.append(button);
    }
    return seg;
  };

  const slotRow = (row: LobbySlotRow): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'main-menu__lobby-row';
    el.classList.toggle('is-yours', row.kind === 'yours');
    el.classList.toggle('is-scenario', row.kind === 'scenario');

    const label = document.createElement('div');
    label.className = 'main-menu__lobby-label';
    const name = document.createElement('span');
    name.className = 'main-menu__lobby-name';
    name.textContent =
      row.slot.name ??
      (row.kind === 'open'
        ? lobby.freeSlot
        : formatMessage(lobby.playerSlotLabel, { n: row.slot.player + 1 }));
    const sub = document.createElement('span');
    sub.className = 'main-menu__lobby-sub';
    const tribe = copy.tribeNames[row.slot.tribeId] ?? `#${row.slot.tribeId}`;
    const subText =
      row.kind === 'yours'
        ? lobby.yourSub
        : row.kind === 'scenario'
          ? lobby.scenarioSub
          : row.vacantMode === 'ai'
            ? lobby.vacantComputerSub
            : lobby.vacantIdleSub;
    sub.textContent = `${tribe} · ${subText}`;
    label.append(name, sub);

    const action = document.createElement('div');
    action.className = 'main-menu__lobby-action';
    if (row.kind === 'open') {
      const sit = document.createElement('button');
      sit.type = 'button';
      sit.className = 'main-menu__lobby-sit';
      sit.textContent = lobby.sit;
      sit.addEventListener('click', () => {
        pickerSlot = null;
        update(claimSeat(state, row.slot.player));
      });
      action.append(sit);
    }

    el.append(chipButton(row), label, controlCell(row), action);
    return el;
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
    pick.disabled = active;
    pick.addEventListener('click', () => {
      pickerSlot = null;
      update(claimSeat(state, seat));
    });
    el.append(label, pick);
    return el;
  };

  const renderSeats = (): void => {
    const rows: HTMLElement[] = [];
    for (const row of lobbySlotRows(item.players, state)) {
      rows.push(slotRow(row));
      if (pickerSlot === row.slot.player) rows.push(pickerStrip(row));
    }
    list.replaceChildren(...rows);
    watchList.replaceChildren(
      watchRow(OBSERVER_SEAT, lobby.observerName, lobby.observerDetail, lobby.observerTaken),
      watchRow(OVERSEER_SEAT, lobby.overseerName, lobby.overseerDetail, lobby.overseerTaken),
    );
  };
  renderSeats();
  gateStart();

  // Esc closes an open colour picker before the menu shell's bubble-phase handler reads it as
  // back-navigation. The button exits below unhook the capture listener deterministically; a
  // shell-driven exit (Esc back-navigation) is caught by the isConnected self-cleanup instead.
  const onKeydown = (event: KeyboardEvent): void => {
    if (!section.isConnected) {
      unhookKeys();
      return;
    }
    if (event.key === 'Escape' && pickerSlot !== null) {
      event.stopPropagation();
      pickerSlot = null;
      renderSeats();
    }
  };
  const unhookKeys = (): void => window.removeEventListener('keydown', onKeydown, true);
  window.addEventListener('keydown', onKeydown, true);
  back.addEventListener('click', unhookKeys);
  change.addEventListener('click', unhookKeys);

  start.addEventListener('click', () => {
    if (start.disabled) return;
    unhookKeys();
    window.location.search = targetSearch(lobbyStartEntry(item.id, state, item.players, options));
  });

  return section;
}
