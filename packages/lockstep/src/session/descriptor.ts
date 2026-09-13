import { components } from '@open-northland/sim';
import { type InitialSaveIdentity, parseInitialSaveIdentity } from './initial-save.js';

const { isValidPlayer, isFogMode } = components;

/** What a roster seat does for a whole session: `human` is played by a person, `ai` by the strategic AI
 *  player, and `idle` sits out. */
export type SeatMode = 'human' | 'ai' | 'idle';

export const SEAT_MODES = ['human', 'ai', 'idle'] as const satisfies readonly SeatMode[];

/** One roster seat as the session runs it. */
export interface SessionSeat {
  readonly player: number;
  readonly mode: SeatMode;
  /** Team colour id, the map's authored colour unless the roster recoloured the seat. */
  readonly color: number;
  /** Explicit lobby team; absent or null preserves the map's diplomacy. */
  readonly team?: number | null;
}

/** The two spectator choices watch the whole map: `observer` issues no command, `overseer` commands
 *  every seat. */
export const OBSERVER_SEAT = 'observer';
export const OVERSEER_SEAT = 'overseer';

export type LocalSeat = number | typeof OBSERVER_SEAT | typeof OVERSEER_SEAT;

/** The world a session plays on; an empty `mapId` is the fallback strip a boot without a map draws. */
export type SessionWorld =
  | { readonly kind: 'map'; readonly mapId: string }
  | { readonly kind: 'scene'; readonly sceneId: string };

/** The world rules the session overrides; null keeps whatever the world set for itself. */
export interface SessionRules {
  /** A `FOG_MODE` id. */
  readonly fog: number | null;
  /** Sets `ProgressionRules.professionProgressionEnabled`, which defines its reach. */
  readonly progression: boolean | null;
  /** Sets `WorldRules.needsEnabled`, which defines what the rule covers. */
  readonly needs: boolean | null;
}

/**
 * One serializable description of what is being played: enough for any client to assemble the same
 * world from the same content, and nothing the world identity already pins.
 *
 * Every field but {@link localSeat} is shared by every client of the session; that one is this
 * client's own view of the roster.
 */
export interface GameSession {
  readonly initialSave?: InitialSaveIdentity;
  readonly kickedSeatMode?: 'ai' | 'idle';
  readonly world: SessionWorld;
  readonly seed: number;
  /** See {@link orderedSeats}. Empty for a world that raises no seats of its own. */
  readonly seats: readonly SessionSeat[];
  readonly localSeat: LocalSeat;
  readonly rules: SessionRules;
  /** Wall-clock multiplier the session starts at. */
  readonly speed: number;
}

/** The seat a session falls back to: the one a spectator still needs for fog perspective and placement
 *  ownership, and the one a search that names no seat plays. */
export const DEFAULT_LOCAL_PLAYER = 0;

export function localPlayerOf(session: GameSession): number {
  return typeof session.localSeat === 'number' ? session.localSeat : DEFAULT_LOCAL_PLAYER;
}

/** True while the local client watches rather than plays: no fog perspective, every seat pickable. */
export function isSpectator(session: GameSession): boolean {
  return typeof session.localSeat !== 'number';
}

/** True for the spectator that may not issue a command at all. */
export function isReadOnlySpectator(session: GameSession): boolean {
  return session.localSeat === OBSERVER_SEAT;
}

export function aiSeatsOf(session: GameSession): number[] {
  return seatsInMode(session, 'ai');
}

/** Every seat a person plays, on whichever client. */
export function humanSeatsOf(session: GameSession): number[] {
  return seatsInMode(session, 'human');
}

function seatsInMode(session: GameSession, mode: SeatMode): number[] {
  return session.seats.filter((seat) => seat.mode === mode).map((seat) => seat.player);
}

/** Seat to team colour; a seat outside the roster keeps its slot id as its colour. */
export function seatColourOf(session: GameSession): (player: number) => number {
  if (session.seats.length === 0) return (player) => player;
  const bySeat = new Map(session.seats.map((seat) => [seat.player, seat.color]));
  return (player) => bySeat.get(player) ?? player;
}

/** Seats in the one order world assembly follows, so two clients holding the same roster enqueue its
 *  setup in the same sequence however they learnt it. */
export function orderedSeats(seats: readonly SessionSeat[]): readonly SessionSeat[] {
  return [...seats].sort((a, b) => a.player - b.player);
}

/**
 * Read a session back from broadcast or stored JSON. Every field is checked, because the sender is
 * another client and a malformed roster would assemble a different world without saying so.
 */
export function parseGameSession(value: unknown): GameSession {
  const raw = asRecord(value, 'session');
  const seats = parseSeats(raw.seats);
  return {
    world: parseWorld(raw.world),
    seed: parseSeed(raw.seed),
    seats,
    localSeat: parseLocalSeat(raw.localSeat, seats),
    rules: parseRules(raw.rules),
    speed: positive(raw.speed, 'speed'),
    ...(raw.initialSave === undefined ? {} : { initialSave: parseInitialSaveIdentity(raw.initialSave) }),
    ...(raw.kickedSeatMode === undefined ? {} : { kickedSeatMode: parseKickedSeatMode(raw.kickedSeatMode) }),
  };
}

function parseWorld(value: unknown): SessionWorld {
  const raw = asRecord(value, 'world');
  if (raw.kind === 'map') return { kind: 'map', mapId: worldId(raw.mapId, 'world.mapId') };
  if (raw.kind === 'scene') return { kind: 'scene', sceneId: worldId(raw.sceneId, 'world.sceneId') };
  throw new Error(`session.world.kind must be 'map' or 'scene', got ${JSON.stringify(raw.kind)}`);
}

/** The sim seeds its generator with 32 bits; a wider seed would name the same world as another. */
const MAX_SEED = 0xffff_ffff;

function parseSeed(value: unknown): number {
  const seed = integer(value, 'seed');
  if (seed < 0 || seed > MAX_SEED) throw new Error(`session seed ${seed} is not a 32-bit value`);
  return seed;
}

/** A world id names a file or a registered scene: one line of printable text. */
function worldId(value: unknown, at: string): string {
  const id = text(value, at);
  if (id.length === 0 || /\p{C}/u.test(id)) throw new Error(`${at} must be one printable line`);
  return id;
}

function parseSeats(value: unknown): readonly SessionSeat[] {
  if (!Array.isArray(value)) throw new Error('session.seats must be an array');
  const seats: SessionSeat[] = [];
  let last = -1;
  for (const entry of value) {
    const raw = asRecord(entry, 'seat');
    const player = integer(raw.player, 'seat.player');
    if (!isValidPlayer(player)) throw new Error(`session seat ${player} is not a player slot`);
    if (player <= last) throw new Error(`session seat ${player} is out of ascending order`);
    last = player;
    const color = integer(raw.color, 'seat.color');
    // The palette's own bound belongs to the content layer; a negative id has no reading anywhere.
    if (color < 0) throw new Error(`session seat ${player} has a negative colour`);
    const team = parseTeam(raw.team);
    seats.push({
      player,
      mode: parseSeatMode(raw.mode),
      color,
      ...(team === undefined ? {} : { team }),
    });
  }
  return seats;
}

function parseTeam(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return value;
  const team = integer(value, 'seat.team');
  if (!isValidPlayer(team)) throw new Error(`session team ${team} is outside the supported range`);
  return team;
}

function parseSeatMode(value: unknown): SeatMode {
  const mode = SEAT_MODES.find((known) => known === value);
  if (mode === undefined) throw new Error(`unknown seat mode ${JSON.stringify(value)}`);
  return mode;
}

function parseLocalSeat(value: unknown, seats: readonly SessionSeat[]): LocalSeat {
  if (value === OBSERVER_SEAT || value === OVERSEER_SEAT) return value;
  const player = integer(value, 'localSeat');
  if (!isValidPlayer(player)) throw new Error(`session localSeat ${player} is not a player slot`);
  if (seats.length > 0 && !seats.some((seat) => seat.player === player)) {
    throw new Error(`session localSeat ${player} is not in the roster`);
  }
  return player;
}

function parseRules(value: unknown): SessionRules {
  const raw = asRecord(value, 'rules');
  return {
    fog: parseFog(raw.fog),
    progression: nullableBoolean(raw.progression, 'rules.progression'),
    needs: nullableBoolean(raw.needs, 'rules.needs'),
  };
}

function parseFog(value: unknown): number | null {
  if (value === null) return null;
  const fog = integer(value, 'rules.fog');
  if (!isFogMode(fog)) throw new Error('rules.fog must name a fog mode');
  return fog;
}

function asRecord(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${at} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, at: string): string {
  if (typeof value !== 'string') throw new Error(`${at} must be a string`);
  return value;
}

function integer(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`${at} must be an integer, got ${JSON.stringify(value)}`);
  }
  return value;
}

function positive(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${at} must be a positive number, got ${JSON.stringify(value)}`);
  }
  return value;
}

function nullableBoolean(value: unknown, at: string): boolean | null {
  if (value === null || typeof value === 'boolean') return value;
  throw new Error(`${at} must be a boolean or null`);
}

function parseKickedSeatMode(value: unknown): 'ai' | 'idle' {
  if (value !== 'ai' && value !== 'idle') throw new Error('kickedSeatMode must be ai or idle');
  return value;
}
