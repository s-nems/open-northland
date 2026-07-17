import { MAP_PLAYER_COLOR_COUNT } from '@open-northland/data';
import { PLAYER_SWATCH_COLORS } from '../../../catalog/roster.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import {
  authoredVacantMode,
  claimSeat,
  hasClaimableSeat,
  initialRosterState,
  type MapPlayerSlot,
  OBSERVER_SEAT,
  type RosterState,
  rosterStartParams,
  setSlotColor,
  toggleVacantMode,
  wornByAnother,
} from './state.js';

/**
 * The map-select player roster panel (DOM half over `state.ts`): one row per listed map player
 * slot, where the person takes a claimable seat, recolours slots (unique picks, unless the map
 * fixes its colours), and pre-sets what an unclaimed claimable seat will do (Idle/AI — shown only
 * where the lobby offers AI). Lobby-hidden slots are not listed.
 */

/** The panel handle the menu drives: show a map's roster, hide for non-maps, read the gating. */
export interface PlayersPanel {
  show(mapId: string, players: readonly MapPlayerSlot[], fixedColors?: boolean): void;
  hide(): void;
  /** False while a shown roster offers a seat and none is claimed — the menu disables Start on it.
   *  A roster with no claimable seat (an all-AI mod map) never gates. */
  readonly seatClaimed: boolean;
  /** The current roster's start params ({@link rosterStartParams}); empty when hidden. */
  startParams(): readonly (readonly [string, string])[];
}

const swatchHex = (colorId: number): string =>
  `#${(PLAYER_SWATCH_COLORS[colorId] ?? 0).toString(16).padStart(6, '0')}`;

/**
 * Mounts the roster panel over the menu template's `[data-menu-players]` fieldset. Choices persist
 * per map for the page's lifetime (switching cards and back keeps the seat), in `states`.
 * `onChange` fires on every state change so the menu re-evaluates the Start gate.
 */
export function mountPlayersPanel(panel: HTMLElement, list: HTMLElement, onChange: () => void): PlayersPanel {
  const states = new Map<string, RosterState>();
  let shown: { mapId: string; players: readonly MapPlayerSlot[]; fixedColors: boolean } | null = null;
  /** The slot whose colour picker strip is open, or null. */
  let pickerSlot: number | null = null;

  const state = (): RosterState => {
    if (shown === null) return initialRosterState([]);
    let s = states.get(shown.mapId);
    if (s === undefined) {
      s = initialRosterState(shown.players);
      states.set(shown.mapId, s);
    }
    return s;
  };
  const update = (next: RosterState): void => {
    if (shown === null) return;
    states.set(shown.mapId, next);
    render();
    onChange();
  };

  // Document-level: the click that opened the picker usually leaves focus outside the panel, so a
  // panel-scoped listener would never hear the Escape. The menu page owns the document, and the
  // guard makes it a no-op while no picker is open.
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && pickerSlot !== null) {
      pickerSlot = null;
      render();
    }
  });

  const slotRow = (slot: MapPlayerSlot): HTMLElement => {
    const copy = messages().menu;
    const s = state();
    const isSeat = s.seat === slot.player;
    const row = document.createElement('div');
    row.className = 'game-menu__player';
    row.classList.toggle('is-claimable', slot.claimable);
    row.classList.toggle('is-taken', isSeat);
    row.dataset.slot = String(slot.player);

    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'game-menu__player-swatch';
    const colorId = s.colors.get(slot.player) ?? slot.colorId;
    swatch.style.background = swatchHex(colorId);
    const colourName = messages().animation.playerColors[colorId] ?? String(colorId);
    const fixed = shown?.fixedColors === true;
    swatch.title = fixed
      ? `${copy.teamColour}: ${colourName} — ${copy.teamColourLocked}`
      : `${copy.teamColour}: ${colourName}`;
    swatch.setAttribute('aria-label', swatch.title);
    swatch.disabled = fixed;
    swatch.setAttribute('aria-expanded', String(pickerSlot === slot.player));
    swatch.addEventListener('click', (ev) => {
      ev.stopPropagation();
      pickerSlot = pickerSlot === slot.player ? null : slot.player;
      render();
    });

    const label = document.createElement('div');
    label.className = 'game-menu__player-label';
    const name = document.createElement('span');
    name.className = 'game-menu__player-name';
    name.textContent = slot.name ?? formatMessage(copy.playerSlotLabel, { n: slot.player + 1 });
    const detail = document.createElement('span');
    detail.className = 'game-menu__player-detail';
    const tribe = copy.tribeNames[slot.tribeId] ?? `#${slot.tribeId}`;
    detail.textContent = `${tribe} · ${slot.type === 'human' ? copy.playerTypeHuman : copy.playerTypeAi}`;
    label.append(name, detail);

    row.append(swatch, label);

    // A claimable seat invites the person to sit (a real button, so the keyboard can take it; the
    // whole row stays clickable too) and carries the Idle/AI toggle while free wherever the lobby
    // offers AI. A non-claimable slot is script-driven and only wears the AI badge.
    if (slot.claimable) {
      const seat = document.createElement('button');
      seat.type = 'button';
      seat.className = 'game-menu__player-seat';
      seat.textContent = isSeat ? copy.seatTaken : copy.seatTake;
      seat.disabled = isSeat;
      seat.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (state().seat !== slot.player) update(claimSeat(state(), slot.player));
      });
      row.append(seat);
      row.addEventListener('click', () => {
        if (state().seat !== slot.player) update(claimSeat(state(), slot.player));
      });
      if (!isSeat && slot.aiAllowed) {
        const vacant = document.createElement('button');
        vacant.type = 'button';
        vacant.className = 'game-menu__player-vacant';
        const mode = s.vacantModes.get(slot.player) ?? authoredVacantMode(slot);
        vacant.textContent = mode === 'ai' ? copy.vacantAi : copy.vacantIdle;
        vacant.title = copy.vacantToggleTitle;
        vacant.addEventListener('click', (ev) => {
          ev.stopPropagation();
          update(toggleVacantMode(state(), slot.player));
        });
        row.append(vacant);
      }
    } else {
      const badge = document.createElement('span');
      badge.className = 'game-menu__player-badge';
      badge.textContent = copy.playerTypeAi;
      row.append(badge);
    }
    return row;
  };

  const pickerStrip = (slot: MapPlayerSlot): HTMLElement => {
    const copy = messages().menu;
    const s = state();
    const own = s.colors.get(slot.player);
    const strip = document.createElement('div');
    strip.className = 'game-menu__player-picker';
    for (let colorId = 0; colorId < MAP_PLAYER_COLOR_COUNT; colorId++) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'game-menu__player-swatch is-option';
      option.style.background = swatchHex(colorId);
      const colourName = messages().animation.playerColors[colorId] ?? String(colorId);
      option.title = `${copy.teamColour}: ${colourName}`;
      // The slot's own colour stays enabled and outlined even when an authored duplicate also
      // wears it; only colours OTHER slots wear are blocked.
      option.disabled = colorId !== own && wornByAnother(s, slot.player, colorId);
      option.classList.toggle('is-current', colorId === own);
      option.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const next = setSlotColor(state(), slot.player, colorId);
        pickerSlot = null;
        if (next !== null) update(next);
        else render();
      });
      strip.append(option);
    }
    return strip;
  };

  // The observer pseudo-seat: watch the match without controlling a slot — every unit and building
  // becomes inspectable in-game. Satisfies the Start gate like a real seat.
  const observerRow = (): HTMLElement => {
    const copy = messages().menu;
    const isSeat = state().seat === OBSERVER_SEAT;
    const row = document.createElement('div');
    row.className = 'game-menu__player is-claimable';
    row.classList.toggle('is-taken', isSeat);

    const label = document.createElement('div');
    label.className = 'game-menu__player-label';
    const name = document.createElement('span');
    name.className = 'game-menu__player-name';
    name.textContent = copy.observerName;
    const detail = document.createElement('span');
    detail.className = 'game-menu__player-detail';
    detail.textContent = copy.observerDetail;
    label.append(name, detail);
    row.append(label);

    const seat = document.createElement('button');
    seat.type = 'button';
    seat.className = 'game-menu__player-seat';
    seat.textContent = isSeat ? copy.observerTaken : copy.seatTake;
    seat.disabled = isSeat;
    seat.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (state().seat !== OBSERVER_SEAT) update(claimSeat(state(), OBSERVER_SEAT));
    });
    row.append(seat);
    row.addEventListener('click', () => {
      if (state().seat !== OBSERVER_SEAT) update(claimSeat(state(), OBSERVER_SEAT));
    });
    return row;
  };

  const render = (): void => {
    list.replaceChildren();
    if (shown === null) return;
    for (const slot of shown.players) {
      if (slot.hidden) continue;
      list.append(slotRow(slot));
      if (pickerSlot === slot.player) list.append(pickerStrip(slot));
    }
    list.append(observerRow());
  };

  return {
    show(mapId, players, fixedColors = false) {
      shown = { mapId, players, fixedColors };
      pickerSlot = null;
      panel.hidden = false;
      render();
      onChange();
    },
    hide() {
      shown = null;
      pickerSlot = null;
      panel.hidden = true;
      list.replaceChildren();
      onChange();
    },
    get seatClaimed() {
      return shown === null || !hasClaimableSeat(shown.players) || state().seat !== null;
    },
    startParams() {
      return shown === null ? [] : rosterStartParams(state(), shown.players);
    },
  };
}
