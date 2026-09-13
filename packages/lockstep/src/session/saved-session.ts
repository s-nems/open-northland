import { type GameSession, parseGameSession } from './descriptor.js';

export interface SavedSessionSeat {
  readonly player: number;
  /** Display identity only; null for an unnamed local human or a vacant seat. */
  readonly nick: string | null;
}

export interface SavedSessionMetadata {
  readonly version: 1;
  readonly descriptor: GameSession;
  readonly roster: readonly SavedSessionSeat[];
}

/** Closed projection: no tokens, connection state or previous initial-save identity can leak through. */
export function createSavedSessionMetadata(
  descriptor: GameSession,
  roster: readonly SavedSessionSeat[],
): SavedSessionMetadata {
  return parsePresent({ version: 1, descriptor, roster });
}

/** Null means a legacy/unrecorded session. Malformed recorded metadata is never treated as legacy. */
export function parseSavedSessionMetadata(value: unknown): SavedSessionMetadata | null {
  return value === null ? null : parsePresent(value);
}

function parsePresent(value: unknown): SavedSessionMetadata {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('saved session metadata must be a record');
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) throw new Error('unsupported saved session metadata version');
  const { initialSave: _initialSave, ...descriptor } = parseGameSession(raw.descriptor);
  if (
    descriptor.seats.length > 0 &&
    typeof descriptor.localSeat === 'number' &&
    !descriptor.seats.some((seat) => seat.player === descriptor.localSeat)
  ) {
    throw new Error('saved session local seat is absent from its roster');
  }
  if (!Array.isArray(raw.roster) || raw.roster.length !== descriptor.seats.length)
    throw new Error('saved session roster must match every descriptor seat');
  const names = new Set<string>();
  const roster = raw.roster.map((entry: unknown, i): SavedSessionSeat => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
      throw new Error('saved roster seat must be a record');
    const seat = descriptor.seats[i];
    const item = entry as Record<string, unknown>;
    if (seat === undefined || item.player !== seat.player)
      throw new Error('saved roster must follow descriptor player order');
    const nick = item.nick;
    if (
      nick !== null &&
      (typeof nick !== 'string' ||
        nick.length === 0 ||
        nick.length > 24 ||
        nick.trim() !== nick ||
        !/^\P{C}+$/u.test(nick))
    )
      throw new Error('saved roster nick must be null or a printable name of at most 24 characters');
    if (seat.mode !== 'human' && nick !== null) throw new Error('only a human saved seat may have a nick');
    if (nick !== null) {
      if (names.has(nick)) throw new Error('saved roster nick must be unique');
      names.add(nick);
    }
    return { player: seat.player, nick };
  });
  return { version: 1, descriptor, roster };
}
