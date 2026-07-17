import { MAP_PLAYER_COLOR_COUNT } from '@open-northland/data';
import { PLAYER_SWATCH_COLORS } from '../../catalog/roster.js';
import { formatMessage, messages } from '../../i18n/index.js';

/**
 * The map-select player roster panel: one row per map player slot (from the map's decoded
 * `playerdata` roster served in `/maps-index`), where the person takes a seat on a Human slot,
 * recolours slots (unique colours), and pre-sets what an unclaimed Human seat will do (Idle/AI —
 * a forward-looking control, carried in the start URL for the future auto-player). The pure state
 * helpers are exported for headless tests; `mountPlayersPanel` is the DOM half.
 */

/** One map player slot as `/maps-index` serves it (the script sidecar's roster). */
export interface MapPlayerSlot {
  readonly player: number;
  readonly type: 'human' | 'ai';
  readonly tribeId: number;
  readonly colorId: number;
  readonly name?: string;
}

/** What a free Human seat does once the game starts (future auto-player control). */
export type VacantMode = 'idle' | 'ai';

/** The person's choices over one map's roster. */
export interface RosterState {
  /** The claimed Human slot id, or null while no seat is taken (Start stays gated). */
  readonly seat: number | null;
  /** Current colour per slot id (initialised from the map's authored colours). */
  readonly colors: ReadonlyMap<number, number>;
  /** Unclaimed Human slots toggled to auto-play; every other free Human seat idles. */
  readonly vacantAi: ReadonlySet<number>;
}

export function initialRosterState(players: readonly MapPlayerSlot[]): RosterState {
  return {
    seat: null,
    colors: new Map(players.map((p) => [p.player, p.colorId])),
    vacantAi: new Set<number>(),
  };
}

/** Claims a Human seat (a re-claim moves the seat); the taken slot stops being a vacant-AI one. */
export function claimSeat(state: RosterState, slot: number): RosterState {
  const vacantAi = new Set(state.vacantAi);
  vacantAi.delete(slot);
  return { ...state, seat: slot, vacantAi };
}

/** Flips one unclaimed Human slot between Idle and AI. */
export function toggleVacantMode(state: RosterState, slot: number): RosterState {
  const vacantAi = new Set(state.vacantAi);
  if (vacantAi.has(slot)) vacantAi.delete(slot);
  else vacantAi.add(slot);
  return { ...state, vacantAi };
}

/** The slot currently wearing `colorId`, or undefined when the colour is free. */
export function slotWearing(state: RosterState, colorId: number): number | undefined {
  for (const [slot, c] of state.colors) if (c === colorId) return slot;
  return undefined;
}

/**
 * Recolours one slot. Colours are unique: picking a colour another slot wears is rejected (null) —
 * except re-picking the slot's own colour, a no-op accepted for idempotent UI.
 */
export function setSlotColor(state: RosterState, slot: number, colorId: number): RosterState | null {
  const wearer = slotWearing(state, colorId);
  if (wearer !== undefined && wearer !== slot) return null;
  const colors = new Map(state.colors);
  colors.set(slot, colorId);
  return { ...state, colors };
}

/**
 * The start-URL params encoding the person's roster choices: `player=<seat>`,
 * `colors=<slot>:<colorId>,…` (only slots recoloured away from the map's authored colour) and
 * `vacantai=<slot>,…` (only free Human seats toggled to AI). Empty until a seat is claimed —
 * the menu gates Start on it.
 */
export function rosterStartParams(
  state: RosterState,
  players: readonly MapPlayerSlot[],
): readonly (readonly [string, string])[] {
  if (state.seat === null) return [];
  const params: (readonly [string, string])[] = [['player', String(state.seat)]];
  const recoloured = players
    .filter((p) => state.colors.get(p.player) !== undefined && state.colors.get(p.player) !== p.colorId)
    .map((p) => `${p.player}:${state.colors.get(p.player)}`);
  if (recoloured.length > 0) params.push(['colors', recoloured.join(',')]);
  const vacant = [...state.vacantAi].sort((a, b) => a - b);
  if (vacant.length > 0) params.push(['vacantai', vacant.join(',')]);
  return params;
}

/** The panel handle the menu drives: show a map's roster, hide for non-maps, read the gating. */
export interface PlayersPanel {
  show(mapId: string, players: readonly MapPlayerSlot[]): void;
  hide(): void;
  /** False while a roster is shown and no seat is claimed — the menu disables Start on it. */
  readonly seatClaimed: boolean;
  /** The current roster's start params ({@link rosterStartParams}); empty when hidden. */
  startParams(): readonly (readonly [string, string])[];
}

const SWATCH_HEX = (colorId: number): string =>
  `#${(PLAYER_SWATCH_COLORS[colorId] ?? 0).toString(16).padStart(6, '0')}`;

/**
 * Mounts the roster panel over the menu template's `[data-menu-players]` fieldset. Choices persist
 * per map for the page's lifetime (switching cards and back keeps the seat), in `states`.
 * `onChange` fires on every state change so the menu re-evaluates the Start gate.
 */
export function mountPlayersPanel(panel: HTMLElement, list: HTMLElement, onChange: () => void): PlayersPanel {
  const states = new Map<string, RosterState>();
  let shown: { mapId: string; players: readonly MapPlayerSlot[] } | null = null;
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

  const slotRow = (slot: MapPlayerSlot): HTMLElement => {
    const copy = messages().menu;
    const s = state();
    const isSeat = s.seat === slot.player;
    const row = document.createElement('div');
    row.className = 'game-menu__player';
    row.classList.toggle('is-human', slot.type === 'human');
    row.classList.toggle('is-taken', isSeat);
    row.dataset.slot = String(slot.player);

    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'game-menu__player-swatch';
    const colorId = s.colors.get(slot.player) ?? slot.colorId;
    swatch.style.background = SWATCH_HEX(colorId);
    const colourName = messages().animation.playerColors[colorId] ?? String(colorId);
    swatch.title = `${copy.teamColour}: ${colourName}`;
    swatch.setAttribute('aria-label', `${copy.teamColour}: ${colourName}`);
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

    if (slot.type === 'human') {
      const seat = document.createElement('span');
      seat.className = 'game-menu__player-seat';
      seat.textContent = isSeat ? copy.seatTaken : copy.seatTake;
      row.append(seat);
      if (!isSeat) {
        const vacant = document.createElement('button');
        vacant.type = 'button';
        vacant.className = 'game-menu__player-vacant';
        vacant.textContent = s.vacantAi.has(slot.player) ? copy.vacantAi : copy.vacantIdle;
        vacant.title = copy.vacantToggleTitle;
        vacant.addEventListener('click', (ev) => {
          ev.stopPropagation();
          update(toggleVacantMode(state(), slot.player));
        });
        row.append(vacant);
      }
      row.addEventListener('click', () => {
        if (state().seat !== slot.player) update(claimSeat(state(), slot.player));
      });
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
    const strip = document.createElement('div');
    strip.className = 'game-menu__player-picker';
    for (let colorId = 0; colorId < MAP_PLAYER_COLOR_COUNT; colorId++) {
      const wearer = slotWearing(s, colorId);
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'game-menu__player-swatch is-option';
      option.style.background = SWATCH_HEX(colorId);
      const colourName = messages().animation.playerColors[colorId] ?? String(colorId);
      option.title = `${copy.teamColour}: ${colourName}`;
      option.disabled = wearer !== undefined && wearer !== slot.player;
      option.classList.toggle('is-current', wearer === slot.player);
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

  const render = (): void => {
    list.replaceChildren();
    if (shown === null) return;
    for (const slot of shown.players) {
      list.append(slotRow(slot));
      if (pickerSlot === slot.player) list.append(pickerStrip(slot));
    }
  };

  return {
    show(mapId, players) {
      shown = { mapId, players };
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
      return shown === null || state().seat !== null;
    },
    startParams() {
      return shown === null ? [] : rosterStartParams(state(), shown.players);
    },
  };
}
