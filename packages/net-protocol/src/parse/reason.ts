import type { CompatibilityIssue } from '../compatibility.js';
import { MAX_REASON_LENGTH } from '../limits.js';
import type { VacantSeatMode } from '../messages.js';
import type { ClosingCode, RelayReason, RelayReasonCode } from '../reasons.js';
import { asCount, asOneOf, asRecord, asString, keysOf } from '../untrusted.js';
import { parseSeatIndex, VACANT_SEAT_MODES } from './room.js';
import { assertNever, parseNick } from './text.js';

type ParamKind =
  | 'count'
  | 'seat'
  | 'nick'
  | 'detail'
  | 'seatMode'
  | 'compatibilityKind'
  | 'compatibilityReason';

type KindOf<V> = [V] extends [number]
  ? 'count' | 'seat'
  : [V] extends [VacantSeatMode]
    ? 'seatMode'
    : [V] extends [CompatibilityIssue['kind']]
      ? 'compatibilityKind'
      : [V] extends [CompatibilityIssue['reason']]
        ? 'compatibilityReason'
        : 'nick' | 'detail';

type ParamsOf<R> = { readonly [K in Exclude<keyof R, 'code'>]-?: KindOf<R[K]> };

/** Every code's values and how each is read; the type holds the names and kinds to the union. */
const REASON_PARAMS: { readonly [C in RelayReasonCode]: ParamsOf<Extract<RelayReason, { code: C }>> } = {
  helloFirst: {},
  helloOverdue: {},
  protocolUnsupported: { client: 'count', relay: 'count' },
  replaced: {},
  messageTooLarge: {},
  malformed: { detail: 'detail' },
  trafficLimit: {},
  relayFault: {},
  alreadyIntroduced: {},
  alreadyInRoom: {},
  notInRoom: {},
  noRoom: {},
  relayFull: { rooms: 'count' },
  roomFull: { members: 'count' },
  gameStarted: {},
  gameNotStarted: {},
  creatorOnly: {},
  noCreator: {},
  savedRulesFixed: {},
  savedSeatsFixed: {},
  noSeat: { player: 'seat' },
  seatTaken: { player: 'seat', nick: 'nick' },
  seatModeUnavailable: { player: 'seat', mode: 'seatMode' },
  seatRequired: {},
  memberUnseated: { nick: 'nick' },
  memberNotReady: { nick: 'nick' },
  incompatible: { nick: 'nick', kind: 'compatibilityKind', reason: 'compatibilityReason' },
  initialSaveMissing: {},
  mapDeliveryOff: {},
  mapUploadHasTick: {},
  notFromSave: {},
  initialSaveForEveryone: {},
  initialSaveTickMismatch: {},
  initialSaveFingerprintMismatch: {},
  retryTooSoon: {},
  mapProviderAway: {},
  creatorHasMap: {},
  lobbyFilesFixed: {},
  noRecipient: { nick: 'nick' },
  alreadyLoaded: {},
  worldOutOfSync: {},
  notLoaded: {},
  ackOutOfOrder: { expected: 'count' },
  tickNotEmitted: { tick: 'count' },
  noWorldYet: {},
  matchEnded: {},
  commandBudget: {},
  envelopeTooLarge: {},
  noPausesLeft: { budget: 'count' },
  seatEmpty: { player: 'seat' },
  voteSelf: {},
  notWaitedFor: { nick: 'nick' },
  voteNotOpen: { seconds: 'count' },
  snapshotUnsynced: {},
  noSnapshot: {},
  initialSaveGeneration: { generation: 'count' },
  worldTickMismatch: { tick: 'count' },
  worldBeforeStart: { tick: 'count' },
  resultTickUnacknowledged: {},
  resultAlreadyReported: {},
  resultDisagreement: {},
  historyBytes: {},
  historyAge: {},
  saveUnsynced: {},
  saveOtherWorld: {},
  saveBeforeStart: {},
  saveUnacknowledged: {},
  saveExpired: {},
  saveTooLarge: {},
};

const REASON_CODES = Object.keys(REASON_PARAMS) as readonly RelayReasonCode[];

const CLOSING_CODES = keysOf<ClosingCode>({
  helloFirst: true,
  helloOverdue: true,
  protocolUnsupported: true,
  replaced: true,
  messageTooLarge: true,
  malformed: true,
  trafficLimit: true,
});

const COMPATIBILITY_KINDS = keysOf<CompatibilityIssue['kind']>({
  report: true,
  content: true,
  map: true,
  client: true,
  protocol: true,
  save: true,
});
const COMPATIBILITY_REASONS = keysOf<CompatibilityIssue['reason']>({ missing: true, mismatch: true });

export function parseRelayReason(value: unknown, at: string): RelayReason {
  const raw = asRecord(value, at);
  const code = asOneOf(raw.code, REASON_CODES, `${at}.code`);
  const reason: Record<string, string | number> = { code };
  for (const [name, kind] of Object.entries<ParamKind>(REASON_PARAMS[code])) {
    reason[name] = parseParam(raw[name], kind, `${at}.${name}`);
  }
  // Each value was read as the table names it, and the table is checked against the union.
  return reason as unknown as RelayReason;
}

/** The code a close frame names, when it is one the relay closes with. */
export function closingCode(text: string): ClosingCode | null {
  return CLOSING_CODES.find((code) => code === text) ?? null;
}

function parseParam(value: unknown, kind: ParamKind, at: string): string | number {
  switch (kind) {
    case 'count':
      return asCount(value, at);
    case 'seat':
      return parseSeatIndex(value, at);
    case 'nick':
      return parseNick(value, at);
    case 'detail':
      return asString(value, at, MAX_REASON_LENGTH);
    case 'seatMode':
      return asOneOf(value, VACANT_SEAT_MODES, at);
    case 'compatibilityKind':
      return asOneOf(value, COMPATIBILITY_KINDS, at);
    case 'compatibilityReason':
      return asOneOf(value, COMPATIBILITY_REASONS, at);
    default:
      return assertNever(kind);
  }
}
