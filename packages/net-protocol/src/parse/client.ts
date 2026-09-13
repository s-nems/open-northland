import { MAX_CHAT_LENGTH, MAX_ROOM_ID_LENGTH, MAX_SPEED } from '../limits.js';
import type { ClientMessage, ClientMessageKind } from '../messages.js';
import { asBoolean, asCount, asOneOf, asPositiveNumber, asRecord, asString, keysOf } from '../untrusted.js';
import { parseCompatibility } from './compatibility.js';
import {
  parseLobbySettings,
  parseRoomSettings,
  parseSeatIndex,
  parseSeatSetups,
  parseTeam,
  VACANT_SEAT_MODES,
} from './room.js';
import { assertNever, asTimestamp, parseLine, parseNick, parseToken } from './text.js';
import { BLOB_TYPES, parseBlobBytes, parseDigest, parseStateHash, parseWireEnvelope } from './wire.js';

export const CLIENT_KINDS = keysOf<ClientMessageKind>({
  hello: true,
  listRooms: true,
  requestInitialSave: true,
  requestMap: true,
  createRoom: true,
  joinRoom: true,
  leaveRoom: true,
  claimSeat: true,
  setSeat: true,
  setReady: true,
  setSettings: true,
  setCompatibility: true,
  start: true,
  loaded: true,
  saveOrders: true,
  ack: true,
  finish: true,
  command: true,
  clock: true,
  kick: true,
  blob: true,
  chat: true,
  pong: true,
});

/** The client kind a raw message claims, for naming what was refused; null when it claims none. */
export function clientMessageKind(value: unknown): ClientMessageKind | null {
  if (typeof value !== 'object' || value === null) return null;
  const kind = (value as { kind?: unknown }).kind;
  return CLIENT_KINDS.find((known) => known === kind) ?? null;
}

export function parseClientMessage(value: unknown): ClientMessage {
  const raw = asRecord(value, 'message');
  const kind = asOneOf(raw.kind, CLIENT_KINDS, 'message.kind');
  switch (kind) {
    case 'hello':
      return {
        kind,
        protocol: asCount(raw.protocol, 'hello.protocol'),
        token: parseToken(raw.token, 'hello.token'),
        nick: parseNick(raw.nick, 'hello.nick'),
      };
    case 'requestInitialSave':
    case 'requestMap':
    case 'listRooms':
    case 'leaveRoom':
    case 'start':
      return { kind };
    case 'createRoom':
      return {
        kind,
        settings: parseRoomSettings(raw.settings, 'createRoom.settings'),
        seats: parseSeatSetups(raw.seats, 'createRoom.seats'),
      };
    case 'joinRoom':
      return { kind, roomId: asString(raw.roomId, 'joinRoom.roomId', MAX_ROOM_ID_LENGTH) };
    case 'claimSeat':
      return { kind, player: raw.player === null ? null : parseSeatIndex(raw.player, 'claimSeat.player') };
    case 'setSeat':
      return {
        kind,
        player: parseSeatIndex(raw.player, 'setSeat.player'),
        ...(raw.mode !== undefined ? { mode: asOneOf(raw.mode, VACANT_SEAT_MODES, 'setSeat.mode') } : {}),
        ...(raw.color !== undefined ? { color: asCount(raw.color, 'setSeat.color') } : {}),
        ...(raw.team !== undefined ? { team: parseTeam(raw.team, 'setSeat.team') } : {}),
      };
    case 'setSettings':
      if (
        ['world', 'initialSave', 'mapOrigin'].some(
          (key) => asRecord(raw.settings, 'setSettings.settings')[key] !== undefined,
        )
      )
        throw new Error('setSettings: the room world, initialSave and mapOrigin are immutable');
      return { kind, settings: parseLobbySettings(raw.settings, 'setSettings.settings') };
    case 'setCompatibility':
      return { kind, compatibility: parseCompatibility(raw.compatibility, 'setCompatibility.compatibility') };
    case 'setReady':
      return { kind, ready: asBoolean(raw.ready, 'setReady.ready') };
    case 'saveOrders':
      return {
        kind,
        id: asCount(raw.id, 'saveOrders.id'),
        tick: asCount(raw.tick, 'saveOrders.tick'),
        world: asCount(raw.world, 'saveOrders.world'),
      };
    case 'loaded':
      if (raw.tick === null) return { kind, tick: null };
      return { kind, tick: asCount(raw.tick, 'loaded.tick'), world: asCount(raw.world, 'loaded.world') };
    case 'finish': {
      const hash = parseStateHash(raw.hash, 'finish.hash');
      return {
        kind,
        tick: asCount(raw.tick, 'finish.tick'),
        hash,
        world: asCount(raw.world, 'finish.world'),
      };
    }
    case 'ack':
      return {
        kind,
        tick: asCount(raw.tick, 'ack.tick'),
        digest: parseDigest(raw.digest, 'ack.digest'),
        world: asCount(raw.world, 'ack.world'),
      };
    case 'command':
      return {
        kind,
        envelope: parseWireEnvelope(raw.envelope, 'command.envelope'),
        fromTick: asCount(raw.fromTick, 'command.fromTick'),
      };
    case 'clock': {
      if (raw.speed === undefined && raw.paused === undefined) {
        throw new Error('clock: names neither a speed nor a pause state');
      }
      return {
        kind,
        ...(raw.speed !== undefined ? { speed: asPositiveNumber(raw.speed, 'clock.speed', MAX_SPEED) } : {}),
        ...(raw.paused !== undefined ? { paused: asBoolean(raw.paused, 'clock.paused') } : {}),
      };
    }
    case 'kick':
      return { kind, player: parseSeatIndex(raw.player, 'kick.player') };
    case 'blob': {
      const type = asOneOf(raw.type, BLOB_TYPES, 'blob.type');
      const tick = raw.tick === null ? null : asCount(raw.tick, 'blob.tick');
      if (type !== 'map' && tick === null) throw new Error(`blob.tick: a ${type} names its tick`);
      return {
        kind,
        type,
        to: raw.to === null ? null : parseNick(raw.to, 'blob.to'),
        tick,
        bytes: parseBlobBytes(raw.bytes, 'blob.bytes'),
      };
    }
    case 'chat':
      return { kind, text: parseLine(raw.text, 'chat.text', MAX_CHAT_LENGTH) };
    case 'pong':
      return { kind, t: asTimestamp(raw.t, 'pong.t') };
    default:
      return assertNever(kind);
  }
}
