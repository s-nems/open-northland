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
export const REPLAY_FORMAT_VERSION = 3;

/** Every replay plays back as a spectator: the recording decides the commands, so the watching
 *  client issues none, and the spectator's sight shows the whole map. */
export function replaySessionOf(descriptor: GameSession): GameSession {
  return { ...descriptor, localSeat: 'observer' };
}

/** The build-side identity a replay is bound to, beside the save format and content version the
 *  header stamps: a sim change without a format bump plays a different match, and only these name
 *  the build that recorded it. */
export interface ReplayIdentity {
  /** The bundle hash of the client packages; `unbundled` when the sources load loose. */
  readonly clientBuild: string;
  /** The release name the build reported. */
  readonly gameVersion: string;
  /** The content fingerprint the lobby pins a room with (`contentLobbyFingerprint`). */
  readonly contentFingerprint: string;
}

export interface ReplayDocument {
  readonly kind: typeof REPLAY_KIND;
  readonly version: typeof REPLAY_FORMAT_VERSION;
  /** The save format the recording sim wrote, so a reader refuses a log its sim cannot reproduce. */
  readonly formatVersion: number;
  /** The content the run was built on, as the save header's `irVersion` pins it. */
  readonly irVersion: number;
  /** The build identity the run was recorded on; a mismatch refuses the replay, saying this. */
  readonly identity: ReplayIdentity;
  /** The terrain fingerprint the recording sim stood on (`Simulation.mapFingerprint`); null when it
   *  kept none. */
  readonly mapFingerprint: string | null;
  /** The state hash the recording took at its last tick; playback checks it there. */
  readonly stateHash: string;
  /** Milliseconds since the epoch, taken at the capture. */
  readonly savedAt: number;
  /** Milliseconds since the epoch, taken when the recorded session began; two captures of one
   *  session carry the same stamp, which is what keys the recording's store slot by. */
  readonly startedAt: number;
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
  readonly startedAt: number;
  readonly irVersion: number;
  readonly identity: ReplayIdentity;
  readonly mapFingerprint: string | null;
  readonly stateHash: string;
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
    `,"clientBuild":${JSON.stringify(parts.identity.clientBuild)}` +
    `,"gameVersion":${JSON.stringify(parts.identity.gameVersion)}` +
    `,"contentFingerprint":${JSON.stringify(parts.identity.contentFingerprint)}` +
    `,"mapFingerprint":${parts.mapFingerprint === null ? 'null' : JSON.stringify(parts.mapFingerprint)}` +
    `,"stateHash":${JSON.stringify(parts.stateHash)}` +
    `,"savedAt":${parts.savedAt}` +
    `,"startedAt":${parts.startedAt}` +
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
  /** The recorded session's own start, which keys its slot; the caller holds it for the session. */
  readonly startedAt: number;
  readonly irVersion: number;
  /** The build identity this client runs on, stamped into the recording. */
  readonly identity: ReplayIdentity;
}

/** The assembled recording as file bytes, with the header the slot list shows. */
export interface ReplayCaptureFile {
  readonly bytes: SaveBytes;
  readonly mapId: string;
  readonly seed: number;
  readonly untilTick: number;
  /** The capture moment the call carried, echoed for the slot's provenance. */
  readonly savedAt: number;
  /** The session start the call carried, echoed for the slot's key and name. */
  readonly startedAt: number;
  /** The build identity the recording was made on, echoed for the slot list's version mark. */
  readonly identity: ReplayIdentity;
}

function identityOf(raw: Record<string, unknown>): ReplayIdentity {
  for (const field of ['clientBuild', 'gameVersion', 'contentFingerprint'] as const) {
    const value = raw[field];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`replay ${field} must be a non-empty string`);
    }
  }
  return {
    clientBuild: raw.clientBuild as string,
    gameVersion: raw.gameVersion as string,
    contentFingerprint: raw.contentFingerprint as string,
  };
}

/** Why this build refuses a replay: the header's build stamps against this build's own, checked
 *  before anything spends time on the recording. The message names the version that recorded it. */
export type ReplayRefusal = { readonly kind: 'otherBuild'; readonly recorded: ReplayDocument };

/** The stamps a build compares a replay's header against wherever it decides to play one: the
 *  bundle's own build and release, and the content version. The content and terrain fingerprints
 *  are compared where their sides are loaded — the menu and the boot know no map, and the worker
 *  that stands the world up knows both. */
export function replayRefusalOn(
  document: ReplayDocument,
  on: { readonly irVersion: number; readonly clientBuild: string; readonly gameVersion: string },
): ReplayRefusal | null {
  const same =
    document.identity.clientBuild === on.clientBuild &&
    document.identity.gameVersion === on.gameVersion &&
    document.irVersion === on.irVersion;
  return same ? null : { kind: 'otherBuild', recorded: document };
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
  if (typeof raw.stateHash !== 'string' || raw.stateHash.length === 0) {
    throw new Error('replay stateHash must be a non-empty string');
  }
  if (
    raw.mapFingerprint !== null &&
    (typeof raw.mapFingerprint !== 'string' || raw.mapFingerprint.length === 0)
  ) {
    throw new Error('replay mapFingerprint must be a fingerprint or null');
  }
  if (typeof raw.savedAt !== 'number' || !Number.isSafeInteger(raw.savedAt)) {
    throw new Error('replay savedAt must be an integer');
  }
  const startedAt = safeInteger(raw.startedAt, 'startedAt');
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
    identity: identityOf(raw),
    mapFingerprint: raw.mapFingerprint,
    stateHash: raw.stateHash,
    savedAt: raw.savedAt,
    startedAt,
    descriptor: parseGameSession(raw.descriptor),
    fromTick,
    untilTick,
    initialSave: raw.initialSave as SaveGameDocument | null,
    log: raw.log.map(loggedCommandOf),
  };
}

/** The store key one recording lives under: its session's start and seed, so two captures of one
 *  session write the same slot and two games that started in one minute never collide. */
export function replaySlotKeyOf(startedAt: number, seed: number): string {
  return `${startedAt}-${seed}`;
}

/** The name one recording lists under, taken from its session's start: stable across the captures a
 *  session saves, whatever moment each was taken at. */
export function replaySlotNameOf(mapId: string, startedAt: number): string {
  const at = new Date(startedAt);
  const pad = (value: number): string => String(value).padStart(2, '0');
  const stamp =
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    ` ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
  return mapId === '' ? stamp : `${mapId} · ${stamp}`;
}
