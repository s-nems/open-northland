import { isMultiplayerMapType } from '@open-northland/data';
import {
  type ComputerDifficulty,
  type DayNightMode,
  DEFAULT_DAY_NIGHT_MODE,
  DEFAULT_LOCAL_PLAYER,
  DEFAULT_WEATHER_MODE,
  type GameSession,
  orderedSeats,
  type PeaceMinutes,
  type ResourceYieldFactor,
  type SessionRules,
  type SessionSeat,
  type StorageCapacityFactor,
  type WeatherMode,
} from '@open-northland/lockstep';
import {
  DEFAULT_FOG_MODE,
  FOG_MODE_BY_NAME,
  LOBBY_FOG_MODES,
  type LobbyFogModeName,
} from '../../../game/fog.js';
import {
  dayNightModeParam,
  mapOreYield,
  onOffParam,
  resourceYieldParam,
  storageCapacityParam,
  weatherModeParam,
} from '../../../game/match/session-rules.js';
import {
  claimableLocalSeat,
  DEFAULT_SESSION_SPEED,
  isReservedMapAiSeat,
  seatMode,
  sessionSearch,
} from '../../../game/match/session-url.js';
import { formatSearch } from '../../../view/params.js';
import type { MapSelectItem } from '../map-select/model.js';
import {
  absentSeats,
  authoredVacantMode,
  claimSeat,
  computerSeats,
  idleSeats,
  initialRosterState,
  type MapPlayerSlot,
  offersDifficulty,
  offersTribeChoice,
  type RosterState,
  slotDifficulty,
  type VacantMode,
} from './roster-state.js';

export interface LobbyOptions {
  fog: LobbyFogModeName;
  professionProgression: boolean;
  settlerNeeds: boolean;
  weather: WeatherMode;
  dayNight: DayNightMode;
  alliedVision: boolean;
  /** Null plays without a peace. */
  peace: PeaceMinutes | null;
  /** Null keeps the storage buildings' own sizes. */
  storageCapacity: StorageCapacityFactor | null;
  /** Null keeps the authored stock of the map's wood, mushrooms, clay and stone. */
  basicYield: ResourceYieldFactor | null;
  /** Null keeps the authored stock of the map's iron and gold. */
  oreYield: ResourceYieldFactor | null;
  papers: boolean;
}

/** Progression, needs and papers default on, so only an explicit `off` in the URL clears the box. Allied vision
 *  is not carried between menu visits: the caller picks it for the kind of game. Every lobby starts
 *  without a peace. */
export function initialLobbyOptions(params: URLSearchParams, alliedVision: boolean): LobbyOptions {
  const fog = params.get('fog');
  return {
    fog: LOBBY_FOG_MODES.find((mode) => mode === fog) ?? DEFAULT_FOG_MODE,
    professionProgression: onOffParam(params, 'progression') !== false,
    settlerNeeds: onOffParam(params, 'needs') !== false,
    weather: weatherModeParam(params) ?? DEFAULT_WEATHER_MODE,
    dayNight: dayNightModeParam(params) ?? DEFAULT_DAY_NIGHT_MODE,
    alliedVision,
    peace: null,
    storageCapacity: storageCapacityParam(params),
    basicYield: resourceYieldParam(params, 'basicYield'),
    oreYield: resourceYieldParam(params, 'oreYield'),
    papers: onOffParam(params, 'papers') !== false,
  };
}

/** The session rules a lobby's options play. */
export function lobbyRules(options: LobbyOptions): SessionRules {
  return {
    fog: FOG_MODE_BY_NAME[options.fog],
    progression: options.professionProgression,
    needs: options.settlerNeeds,
    weather: options.weather,
    dayNight: options.dayNight,
    alliedVision: options.alliedVision,
    peace: options.peace,
    storageCapacity: options.storageCapacity,
    basicYield: options.basicYield,
    oreYield: options.oreYield,
    papers: options.papers,
  };
}

/** A known-terrain map previews the whole of an authored single-player map, so a local lobby on one
 *  plays the classic map, keeping only the fog-of-war choice. */
const CLASSIC_MAP_FOG: Readonly<Record<LobbyFogModeName, LobbyFogModeName>> = {
  classic: 'classic',
  'classic-fow': 'classic-fow',
  recon: 'classic',
  'recon-fow': 'classic-fow',
};

/** The options a local lobby opens `mapTypes` with: a multiplayer map offers the map setting and
 *  starts with allied vision, a single-player one plays the classic map without it. */
export function localLobbyOptions(params: URLSearchParams, mapTypes: readonly number[]): LobbyOptions {
  const multiplayer = isMultiplayerMapType(mapTypes);
  const options = initialLobbyOptions(params, multiplayer);
  return multiplayer ? options : { ...options, fog: CLASSIC_MAP_FOG[options.fog] };
}

/** A fresh lobby pre-seats the player in the first claimable listed slot; all-AI maps stay seatless. */
export function initialLobbyState(players: readonly MapPlayerSlot[]): RosterState {
  const state = initialRosterState(players);
  const first = players.find((slot) => slot.claimable && !slot.hidden);
  return first === undefined ? state : claimSeat(state, first.player);
}

export interface LobbySlotRow {
  readonly slot: MapPlayerSlot;
  /** Current team colour (the person's pick, else authored). */
  readonly colorId: number;
  /** `yours` = the claimed seat, `scenario` = script-driven and locked, `open` = claimable. */
  readonly kind: 'yours' | 'scenario' | 'open';
  /** What the seat does at start while vacant. */
  readonly vacantMode: VacantMode;
  /** Current civilization (the person's pick, else authored). */
  readonly tribe: number;
  /** False for a monster seat, which keeps its own tribe. */
  readonly offersTribe: boolean;
  /** How hard the seat plays; null while no computer plays it, or while no strategic AI runs it: a
   *  monster seat, or a scripted camp. */
  readonly difficulty: ComputerDifficulty | null;
}

/** The listed slot rows in authored order; hidden slots never render. */
export function lobbySlotRows(
  players: readonly MapPlayerSlot[],
  state: RosterState,
): readonly LobbySlotRow[] {
  return players
    .filter((slot) => !slot.hidden)
    .map((slot) => ({
      slot,
      colorId: state.colors.get(slot.player) ?? slot.colorId,
      kind: slot.player === state.seat ? 'yours' : slot.claimable ? 'open' : 'scenario',
      vacantMode: state.vacantModes.get(slot.player) ?? authoredVacantMode(slot),
      tribe: state.tribes.get(slot.player) ?? slot.tribeId,
      offersTribe: offersTribeChoice(slot),
      difficulty: playsAtDifficulty(slot, state) ? slotDifficulty(state, slot) : null,
    }));
}

/** Whether the computer plays `slot` at a level: the map's own computer seat always, an offered seat
 *  once the lobby hands it over. */
function playsAtDifficulty(slot: MapPlayerSlot, state: RosterState): boolean {
  if (!offersDifficulty(slot)) return false;
  return (
    (isReservedMapAiSeat(slot) && slot.hasComputerControl) ||
    (state.seat !== null && computerSeats(state, [slot]).length > 0)
  );
}

/**
 * The session Start launches. Every rule is set rather than left to the world, so a stale carried param
 * cannot leak into the next map. A roster with no claimable seat starts seatless: nothing is claimed
 * and no offered seat auto-plays or leaves the map; the map's own computer seats play either way.
 */
export function lobbySession(
  mapId: string,
  state: RosterState,
  players: readonly MapPlayerSlot[],
  options: LobbyOptions,
  seed: number,
): GameSession {
  const lists = {
    computer: new Set(state.seat === null ? [] : computerSeats(state, players)),
    idle: new Set(
      state.seat === null
        ? players.filter((slot) => slot.claimable).map((slot) => slot.player)
        : idleSeats(state, players),
    ),
    absent: new Set(state.seat === null ? [] : absentSeats(state, players)),
  };
  const localSeat = claimableLocalSeat(state.seat ?? DEFAULT_LOCAL_PLAYER, players);
  const seats: SessionSeat[] = players.map((slot) => {
    const tribe = state.tribes.get(slot.player);
    const retribed = tribe !== undefined && tribe !== slot.tribeId && offersTribeChoice(slot);
    const mode = seatMode(slot, localSeat, lists);
    const difficulty =
      (mode === 'computer' || (mode === 'map-ai' && slot.hasComputerControl)) && offersDifficulty(slot)
        ? slotDifficulty(state, slot)
        : undefined;
    return {
      player: slot.player,
      mode,
      color: state.colors.get(slot.player) ?? slot.colorId,
      ...(retribed ? { tribe } : {}),
      ...(difficulty === undefined ? {} : { difficulty }),
    };
  });
  // A seatless roster falls back to a seat the map may not list; the launched game plays it, so the
  // launch URL has to carry it. It keeps its slot id as its colour.
  if (typeof localSeat === 'number' && !players.some((slot) => slot.player === localSeat)) {
    seats.push({ player: localSeat, mode: 'human', color: localSeat });
  }
  return {
    world: { kind: 'map', mapId },
    seed,
    seats: orderedSeats(seats),
    localSeat,
    rules: lobbyRules(options),
    speed: DEFAULT_SESSION_SPEED,
  };
}

/** The `?map=` entry Start navigates to: {@link lobbySession} as a URL. */
export function lobbyStartEntry(
  mapId: string,
  state: RosterState,
  players: readonly MapPlayerSlot[],
  options: LobbyOptions,
  seed: number,
): string {
  return formatSearch(sessionSearch(lobbySession(mapId, state, players, options, seed), players));
}

/** A lobby's ore richness after its map changes from `from` to `to` (a mode switched on or off), with
 *  the player's own choice (`own`) it gives back when the new map brings no default; a choice made over
 *  a map's own default is the player's too. */
export function oreYieldAcrossMaps(
  from: Pick<MapSelectItem, 'roomDefaults'>,
  to: Pick<MapSelectItem, 'roomDefaults'>,
  choice: { readonly oreYield: ResourceYieldFactor | null; readonly own: ResourceYieldFactor | null },
): { oreYield: ResourceYieldFactor | null; own: ResourceYieldFactor | null } {
  const fromOre = mapOreYield(from.roomDefaults);
  const own = fromOre === null || choice.oreYield !== fromOre ? choice.oreYield : choice.own;
  return { oreYield: mapOreYield(to.roomDefaults) ?? own, own };
}
