import type { GameSession } from '@open-northland/lockstep';
import { MAX_CHAT_LENGTH, MAX_REASON_LENGTH, MAX_SPEED } from '../limits.js';
import type { ServerMessage, WaitedMember, WaitReason } from '../messages.js';
import {
  asArray,
  asBoolean,
  asCount,
  asNonNegativeNumber,
  asOneOf,
  asPositiveNumber,
  asRecord,
  asString,
  keysOf,
} from '../untrusted.js';
import { CLIENT_KINDS } from './client.js';
import { parseRoomSummary, parseRoomView, parseSeatIndex, VACANT_SEAT_MODES } from './room.js';
import { parseSaveOrders } from './save-orders.js';
import { assertNever, asTimestamp, parseLine, parseNick } from './text.js';
import { BLOB_TYPES, parseBlobBytes, parseStateHash, parseWireCommands, SYNC_DOMAINS } from './wire.js';

const SERVER_KINDS = keysOf<ServerMessage['kind']>({
  welcome: true,
  rooms: true,
  room: true,
  left: true,
  start: true,
  ended: true,
  saveOrders: true,
  clock: true,
  frame: true,
  delay: true,
  waiting: true,
  kickVote: true,
  kicked: true,
  desync: true,
  snapshotRequest: true,
  mapRequest: true,
  blob: true,
  chat: true,
  ping: true,
  rejected: true,
  error: true,
});

const WAIT_REASONS = keysOf<WaitReason>({
  gone: true,
  silent: true,
  loading: true,
  lagging: true,
  resync: true,
});

/**
 * The client side of the wire. The session descriptor belongs to the lockstep package, so its parser
 * is passed in rather than imported: this package carries no runtime dependency.
 */
export function parseServerMessage(
  value: unknown,
  parseSession: (session: unknown) => GameSession,
): ServerMessage {
  const raw = asRecord(value, 'message');
  const kind = asOneOf(raw.kind, SERVER_KINDS, 'message.kind');
  switch (kind) {
    case 'welcome':
      return {
        kind,
        protocol: asCount(raw.protocol, 'welcome.protocol'),
        nick: parseNick(raw.nick, 'welcome.nick'),
      };
    case 'rooms':
      return {
        kind,
        rooms: asArray(raw.rooms, 'rooms.rooms').map((room, i) => parseRoomSummary(room, `rooms[${i}]`)),
      };
    case 'room':
      return { kind, room: parseRoomView(raw.room, 'room.room') };
    case 'left':
    case 'snapshotRequest':
      return { kind };
    case 'start':
      return {
        kind,
        session: parseSession(raw.session),
        snapshotTick: raw.snapshotTick === null ? null : asCount(raw.snapshotTick, 'start.snapshotTick'),
      };
    case 'saveOrders':
      return parseSaveOrders(raw);
    case 'ended':
      return { kind, tick: asCount(raw.tick, 'ended.tick'), hash: parseStateHash(raw.hash, 'ended.hash') };
    case 'clock':
      return {
        kind,
        tick: asCount(raw.tick, 'clock.tick'),
        speed: asPositiveNumber(raw.speed, 'clock.speed', MAX_SPEED),
        paused: asBoolean(raw.paused, 'clock.paused'),
        by: raw.by === null ? null : parseNick(raw.by, 'clock.by'),
      };
    case 'frame':
      return {
        kind,
        tick: asCount(raw.tick, 'frame.tick'),
        commands: parseWireCommands(raw.commands, 'frame.commands'),
      };
    case 'delay':
      return { kind, ticks: asCount(raw.ticks, 'delay.ticks') };
    case 'waiting':
      return {
        kind,
        for: asArray(raw.for, 'waiting.for').map((entry, i) => parseWaitedMember(entry, `waiting.for[${i}]`)),
      };
    case 'kickVote':
      return {
        kind,
        player: parseSeatIndex(raw.player, 'kickVote.player'),
        nick: parseNick(raw.nick, 'kickVote.nick'),
        yes: asArray(raw.yes, 'kickVote.yes').map((nick, i) => parseNick(nick, `kickVote.yes[${i}]`)),
        needed: asCount(raw.needed, 'kickVote.needed'),
      };
    case 'kicked':
      return {
        kind,
        player: parseSeatIndex(raw.player, 'kicked.player'),
        nick: parseNick(raw.nick, 'kicked.nick'),
        mode: asOneOf(raw.mode, VACANT_SEAT_MODES, 'kicked.mode'),
        tick: asCount(raw.tick, 'kicked.tick'),
      };
    case 'desync':
      return {
        kind,
        tick: asCount(raw.tick, 'desync.tick'),
        domains: asArray(raw.domains, 'desync.domains').map((domain, i) =>
          asOneOf(domain, SYNC_DOMAINS, `desync.domains[${i}]`),
        ),
        reference: parseNick(raw.reference, 'desync.reference'),
      };
    case 'mapRequest':
      return { kind, from: parseNick(raw.from, 'mapRequest.from') };
    case 'blob':
      return {
        kind,
        type: asOneOf(raw.type, BLOB_TYPES, 'blob.type'),
        from: parseNick(raw.from, 'blob.from'),
        tick: raw.tick === null ? null : asCount(raw.tick, 'blob.tick'),
        bytes: parseBlobBytes(raw.bytes, 'blob.bytes'),
      };
    case 'chat':
      return {
        kind,
        from: parseNick(raw.from, 'chat.from'),
        text: parseLine(raw.text, 'chat.text', MAX_CHAT_LENGTH),
      };
    case 'ping':
      return {
        kind,
        t: asTimestamp(raw.t, 'ping.t'),
        roundTripMs: asNonNegativeNumber(raw.roundTripMs, 'ping.roundTripMs'),
      };
    case 'rejected':
      return {
        kind,
        of: asOneOf(raw.of, CLIENT_KINDS, 'rejected.of'),
        reason: asString(raw.reason, 'rejected.reason', MAX_REASON_LENGTH),
        ...(raw.requestId === undefined ? {} : { requestId: asCount(raw.requestId, 'rejected.requestId') }),
      };
    case 'error':
      return { kind, reason: asString(raw.reason, 'error.reason', MAX_REASON_LENGTH) };
    default:
      return assertNever(kind);
  }
}

function parseWaitedMember(value: unknown, at: string): WaitedMember {
  const raw = asRecord(value, at);
  return {
    nick: parseNick(raw.nick, `${at}.nick`),
    reason: asOneOf(raw.reason, WAIT_REASONS, `${at}.reason`),
    voteAfterMs: asCount(raw.voteAfterMs, `${at}.voteAfterMs`),
  };
}
