import { type GameSession, parseGameSession } from '@open-northland/lockstep';
import { type LoggedCommand, SAVE_FORMAT_VERSION } from '@open-northland/sim';
import type { SaveBytes } from './codec.js';

/**
 * The persisted replay: the world identity it played on, the state it started from, and every command
 * its session applied. A replayed session rebuilds the world from the descriptor and re-admits the
 * log through `ReplayTransport`, so the recording, not a save of the end state, carries the run.
 *
 * Persisted formats are replaced, never migrated: a reader accepts exactly its own version.
 */

export const REPLAY_KIND = 'open-northland-replay';

/** Single monotonic version of the whole persisted layout; any layout change bumps it. */
export const REPLAY_FORMAT_VERSION = 1;

/** Every replay plays back as a spectator: the recording decides the commands, so the watching
 *  client issues none, and the spectator's sight shows the whole map. */
export function replaySessionOf(descriptor: GameSession): GameSession {
  return { ...descriptor, localSeat: 'observer' };
}

export interface ReplayDocument {
  readonly kind: typeof REPLAY_KIND;
  readonly version: typeof REPLAY_FORMAT_VERSION;
  /** The save format the recording sim wrote, so a reader refuses a log its sim cannot reproduce. */
  readonly formatVersion: number;
  /** The content the run was built on, as the save header's `irVersion` pins it. */
  readonly irVersion: number;
  /** Milliseconds since the epoch, taken at the capture. */
  readonly savedAt: number;
  /** The world identity the session ran on, with the seats and rules it was assembled from. */
  readonly descriptor: GameSession;
  /** The tick the world build stands at: entries at or before it belong to the build the playback
   *  re-runs, entries after it are the recording. */
  readonly fromTick: number;
  /** The last tick the recording covers, the capturing session's tick. */
  readonly untilTick: number;
  /** The save the session restored from, embedded as the document its text parsed to, or null for a
   *  world built from the descriptor alone. */
  readonly initialSave: SaveGameDocument | null;
  /** The recorded commands, ascending in `(applyTick, sequence)` as the queue logged them. */
  readonly log: readonly LoggedCommand[];
}

/** A parsed save document as JSON holds it; `parseSaveGame` validates it. */
export type SaveGameDocument = Record<string, unknown>;

/** The pieces a replay capture holds beside the text it assembles them into. */
export interface ReplayCaptureParts {
  readonly savedAt: number;
  readonly irVersion: number;
  readonly descriptor: GameSession;
  readonly fromTick: number;
  readonly untilTick: number;
  readonly initialSaveText: string | null;
  /** The queue's own serialization of the log (`CommandQueue.logText`). */
  readonly logText: string;
}

/** Canonical JSON text, assembled from the pieces without re-serializing the log's own text. */
export function replayDocumentTextOf(parts: ReplayCaptureParts): string {
  return (
    `{"kind":${JSON.stringify(REPLAY_KIND)}` +
    `,"version":${REPLAY_FORMAT_VERSION}` +
    `,"formatVersion":${SAVE_FORMAT_VERSION}` +
    `,"irVersion":${parts.irVersion}` +
    `,"savedAt":${parts.savedAt}` +
    `,"descriptor":${JSON.stringify(parts.descriptor)}` +
    `,"fromTick":${parts.fromTick}` +
    `,"untilTick":${parts.untilTick}` +
    `,"initialSave":${parts.initialSaveText ?? 'null'}` +
    `,"log":${parts.logText}}`
  );
}

function safeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`replay ${field} must be a non-negative safe integer`);
  }
  return value;
}

function loggedCommandOf(value: unknown, at: number): LoggedCommand {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`replay log entry ${at} must be a record`);
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.command !== 'object' || raw.command === null || Array.isArray(raw.command)) {
    throw new Error(`replay log entry ${at} carries no command`);
  }
  if (typeof raw.origin !== 'string') throw new Error(`replay log entry ${at} carries no origin`);
  // The command's shape is the sim's own from when it applied; `ReplayTransport` hands it to
  // `enqueueAt`, which validates the tick it claims.
  return {
    ...(raw as unknown as LoggedCommand),
    applyTick: safeInteger(raw.applyTick, `log entry ${at} applyTick`),
    sequence: safeInteger(raw.sequence, `replay log entry ${at} sequence`),
  };
}

/** What the capture call carries beside the sim: the stamps only the capture moment knows. The
 *  recording's save-format stamp is this build's own, so both sides import it rather than pass it. */
export interface ReplayCaptureOptions {
  readonly savedAt: number;
  readonly irVersion: number;
}

/** The assembled recording as file bytes, with the header the slot list shows. */
export interface ReplayCaptureFile {
  readonly bytes: SaveBytes;
  readonly mapId: string;
  readonly seed: number;
  readonly untilTick: number;
  /** The capture moment the call carried, echoed for the slot's provenance. */
  readonly savedAt: number;
}

/** Parse a replay's text: kind, version, ticks, descriptor and every log entry are checked before
 *  anything else reads them. Throws on any other shape or version. */
export function parseReplayDocument(text: string): ReplayDocument {
  const value: unknown = JSON.parse(text);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('a replay must be a record');
  }
  const raw = value as Record<string, unknown>;
  if (raw.kind !== REPLAY_KIND) throw new Error('this file is not a replay');
  if (raw.version !== REPLAY_FORMAT_VERSION) throw new Error('unsupported replay format version');
  if (typeof raw.formatVersion !== 'number' || raw.formatVersion !== SAVE_FORMAT_VERSION) {
    throw new Error('the replay was recorded on another save format');
  }
  if (typeof raw.irVersion !== 'number') throw new Error('replay irVersion must be a number');
  if (typeof raw.savedAt !== 'number' || !Number.isSafeInteger(raw.savedAt)) {
    throw new Error('replay savedAt must be an integer');
  }
  const untilTick = safeInteger(raw.untilTick, 'untilTick');
  const fromTick = safeInteger(raw.fromTick, 'fromTick');
  if (fromTick > untilTick) throw new Error('replay fromTick must not sit past untilTick');
  if (raw.initialSave !== null && (typeof raw.initialSave !== 'object' || Array.isArray(raw.initialSave))) {
    throw new Error('replay initialSave must be a save document or null');
  }
  if (!Array.isArray(raw.log)) throw new Error('replay log must be an array');
  return {
    kind: REPLAY_KIND,
    version: REPLAY_FORMAT_VERSION,
    formatVersion: SAVE_FORMAT_VERSION,
    irVersion: raw.irVersion,
    savedAt: raw.savedAt,
    descriptor: parseGameSession(raw.descriptor),
    fromTick,
    untilTick,
    initialSave: raw.initialSave as SaveGameDocument | null,
    log: raw.log.map(loggedCommandOf),
  };
}
