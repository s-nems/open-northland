import {
  clientMessageKind,
  PROTOCOL_VERSION,
  type RoomSettings,
  type ServerMessage,
  type WireDigest,
} from '@open-northland/net-protocol';
import { type ClientHandle, Relay } from '@open-northland/net-server';
import { TEST_COMPATIBILITY } from './compatibility.js';

/** The relay driven message by message with no sim behind it, on a clock the test moves. */

export const SETTINGS: RoomSettings = {
  name: 'Zatoka',
  world: { kind: 'map', mapId: 'zatoka' },
  seed: 7,
  rules: { fog: null, progression: null, needs: null },
  speed: 1,
};
export const SEATS = [
  { player: 0, mode: 'idle', offers: ['idle', 'ai', 'absent'], color: 0 },
  { player: 1, mode: 'idle', offers: ['idle', 'ai', 'absent'], color: 1 },
  { player: 2, mode: 'ai', offers: ['idle', 'ai', 'absent'], color: 2 },
] as const;
export const TOKEN_A = 'token-a-0123456789ab';
export const TOKEN_B = 'token-b-0123456789ab';
export const TOKEN_C = 'token-c-0123456789ab';

export interface Peer {
  readonly handle: ClientHandle;
  readonly sent: ServerMessage[];
  readonly closed: () => string | null;
  send(message: unknown, bytes?: number): void;
  /** Messages of one kind received so far. */
  of<K extends ServerMessage['kind']>(kind: K): Extract<ServerMessage, { kind: K }>[];
  last<K extends ServerMessage['kind']>(kind: K): Extract<ServerMessage, { kind: K }> | undefined;
}

export interface MessageStage {
  readonly relay: Relay;
  readonly now: () => number;
  advance(ms: number): void;
  peer(): Peer;
  introduce(token: string, nick: string): Peer;
}

export function stage(autoCompatibility = true): MessageStage {
  const time = { ms: 0 };
  const relay = new Relay({ now: () => time.ms });
  const advance = (ms: number): void => {
    time.ms += ms;
    relay.advance();
  };
  const peer = (): Peer => {
    const sent: ServerMessage[] = [];
    let closedFor: string | null = null;
    const handle = relay.connect({
      send: (message) => sent.push(message),
      close: (reason) => {
        closedFor = reason;
      },
    });
    const of = <K extends ServerMessage['kind']>(kind: K) =>
      sent.filter((message): message is Extract<ServerMessage, { kind: K }> => message.kind === kind);
    return {
      handle,
      sent,
      closed: () => closedFor,
      send: (message, bytes) => {
        relay.receive(handle, message, bytes);
        const kind = clientMessageKind(message);
        if (
          autoCompatibility &&
          (kind === 'hello' || kind === 'createRoom' || kind === 'joinRoom') &&
          handle.room?.state === 'lobby' &&
          handle.member?.compatibility === null
        ) {
          relay.receive(handle, { kind: 'setCompatibility', compatibility: TEST_COMPATIBILITY });
        }
      },
      of,
      last: (kind) => of(kind).at(-1),
    };
  };
  const introduce = (token: string, nick: string): Peer => {
    const p = peer();
    p.send({ kind: 'hello', protocol: PROTOCOL_VERSION, token, nick });
    return p;
  };
  return { relay, now: () => time.ms, advance, peer, introduce };
}

/** Two seated, ready members in a started room whose clock is running. */
export function startedRoom() {
  const s = stage();
  const a = s.introduce(TOKEN_A, 'Ania');
  const b = s.introduce(TOKEN_B, 'Bartek');
  a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
  const roomId = a.last('room')?.room.id;
  if (roomId === undefined) throw new Error('no room');
  b.send({ kind: 'joinRoom', roomId });
  a.send({ kind: 'claimSeat', player: 0 });
  b.send({ kind: 'claimSeat', player: 1 });
  a.send({ kind: 'setReady', ready: true });
  b.send({ kind: 'setReady', ready: true });
  a.send({ kind: 'start' });
  a.send({ kind: 'loaded', tick: 0, world: 0 });
  b.send({ kind: 'loaded', tick: 0, world: 0 });
  return { ...s, a, b, roomId };
}

export function seatCommand(player: number, value = 0): unknown {
  return {
    kind: 'command',
    envelope: {
      v: 1,
      origin: 'player',
      player,
      command: { kind: 'setAssistantCounter', player, counter: 'extraMen', value, infinite: false },
    },
    fromTick: 0,
  };
}

export function digest(word: number): WireDigest {
  return { rng: word, entities: 0, players: 0, movement: 0, settlers: 0, economy: 0, combat: 0, fog: 0 };
}

/** Acknowledge every emitted tick up to `tick` with one digest word, from the descriptor's world. */
export function ackThrough(peer: Peer, fromTick: number, tick: number, word = 1, world = 0): void {
  for (let t = fromTick; t <= tick; t++) peer.send({ kind: 'ack', tick: t, digest: digest(word), world });
}
