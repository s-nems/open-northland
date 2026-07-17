import { MAP_PLAYER_COLOR_COUNT } from '@open-northland/data';
import { PLAYER_SWATCH_COLORS } from '../../catalog/roster.js';
import { formatMessage, messages } from '../../i18n/index.js';

/**
 * The map-select player roster panel: one row per map player slot (from the map's decoded
 * `playerdata` roster + `[multiplayer]` lobby table served in `/maps-index`), where the person
 * takes a claimable seat, recolours slots (unique colours, unless the map fixes them), and
 * pre-sets what an unclaimed Human seat will do (Idle/AI — a forward-looking control, carried in
 * the start URL for the future auto-player). Lobby-hidden slots are not listed. The pure state
 * helpers are exported for headless tests; `mountPlayersPanel` is the DOM half.
 */

/** One map player slot as `/maps-index` serves it (the script sidecar's roster + lobby table). */
export interface MapPlayerSlot {
  readonly player: number;
  /** The authored `playerdata` type — what the slot does when nobody sits on it. */
  readonly type: 'human' | 'ai';
  readonly tribeId: number;
  readonly colorId: number;
  readonly name?: string;
  /** Whether a person may take this seat (authored `human`, or the map's `[multiplayer]`
   *  `playeroption` row offers `human` — the original lobby's seat-eligibility table). */
  readonly claimable: boolean;
  /** `[multiplayer]` `playerhideinmenu` — never listed (but still in the game and wearing its
   *  authored colour, so its colour stays reserved in the picker). */
  readonly hidden: boolean;
}

/** What a free claimable seat does once the game starts (future auto-player control). */
export type VacantMode = 'idle' | 'ai';

/** A slot's authored vacant default: an `ai` slot auto-plays, a `human` one idles. */
export function authoredVacantMode(slot: MapPlayerSlot): VacantMode {
  return slot.type === 'ai' ? 'ai' : 'idle';
}

/** The person's choices over one map's roster. */
export interface RosterState {
  /** The claimed slot id, or null while no seat is taken (Start stays gated). */
  readonly seat: number | null;
  /** Current colour per slot id (initialised from the map's authored colours). */
  readonly colors: ReadonlyMap<number, number>;
  /** Per-slot vacant mode, initialised from the authored type ({@link authoredVacantMode}). */
  readonly vacantModes: ReadonlyMap<number, VacantMode>;
}

export function initialRosterState(players: readonly MapPlayerSlot[]): RosterState {
  return {
    seat: null,
    colors: new Map(players.map((p) => [p.player, p.colorId])),
    vacantModes: new Map(players.map((p) => [p.player, authoredVacantMode(p)])),
  };
}

/** Claims a seat (a re-claim moves it); the vacated slot keeps its remembered vacant mode. */
export function claimSeat(state: RosterState, slot: number): RosterState {
  return { ...state, seat: slot };
}

/** Flips one unclaimed claimable slot between Idle and AI. */
export function toggleVacantMode(state: RosterState, slot: number): RosterState {
  const vacantModes = new Map(state.vacantModes);
  vacantModes.set(slot, vacantModes.get(slot) === 'ai' ? 'idle' : 'ai');
  return { ...state, vacantModes };
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
 * `vacant=<slot>:<idle|ai>,…` (only unclaimed claimable seats toggled away from their authored
 * default — the future auto-player control; no consumer reads it yet). Empty until a seat is
 * claimed — the menu gates Start on it.
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
  const vacant = players
    .filter(
      (p) =>
        p.claimable &&
        !p.hidden &&
        p.player !== state.seat &&
        (state.vacantModes.get(p.player) ?? authoredVacantMode(p)) !== authoredVacantMode(p),
    )
    .map((p) => `${p.player}:${state.vacantModes.get(p.player)}`);
  if (vacant.length > 0) params.push(['vacant', vacant.join(',')]);
  return params;
}

/** The panel handle the menu drives: show a map's roster, hide for non-maps, read the gating. */
export interface PlayersPanel {
  show(mapId: string, players: readonly MapPlayerSlot[], fixedColors?: boolean): void;
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
    swatch.style.background = SWATCH_HEX(colorId);
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

    // A claimable seat invites the person to sit and carries the same Idle/AI toggle while free
    // (its default follows the authored type — the lobby treats open seats interchangeably).
    // A non-claimable slot is script-driven and only wears the AI badge.
    if (slot.claimable) {
      const seat = document.createElement('span');
      seat.className = 'game-menu__player-seat';
      seat.textContent = isSeat ? copy.seatTaken : copy.seatTake;
      row.append(seat);
      row.addEventListener('click', () => {
        if (state().seat !== slot.player) update(claimSeat(state(), slot.player));
      });
      if (!isSeat) {
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
      if (slot.hidden) continue;
      list.append(slotRow(slot));
      if (pickerSlot === slot.player) list.append(pickerStrip(slot));
    }
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
      return shown === null || state().seat !== null;
    },
    startParams() {
      return shown === null ? [] : rosterStartParams(state(), shown.players);
    },
  };
}
