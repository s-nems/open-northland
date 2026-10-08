import type { GameSession } from '@open-northland/lockstep';
import { RelayClient, RelayState } from '@open-northland/net-client';
import {
  type ChatLine,
  MAX_CHAT_HISTORY_LINES,
  PROTOCOL_VERSION,
  type RoomView,
} from '@open-northland/net-protocol';
import { expect, it } from 'vitest';

const SESSION: GameSession = {
  world: { kind: 'map', mapId: 'test' },
  seed: 3,
  seats: [{ player: 0, mode: 'human', color: 0 }],
  localSeat: 0,
  rules: { fog: null, progression: null, needs: null, weather: null, alliedVision: null },
  speed: 1,
};

const ROOM: RoomView = {
  id: 'room',
  state: 'running',
  creator: 'Ania',
  settings: { name: 'Game', world: SESSION.world, seed: 3, speed: 1, rules: SESSION.rules },
  seats: [{ player: 0, mode: 'human', offers: ['idle'], color: 0, nick: 'Ania', ready: true }],
  members: [
    {
      nick: 'Ania',
      seat: 0,
      connected: true,
      compatibility: null,
      load: null,
      loading: null,
      roundTripMs: null,
      delayTicks: null,
      behindTicks: 0,
    },
  ],
};

function stateOf(view: RelayClient | RelayState) {
  return {
    nick: view.nick,
    welcomed: view.welcomed,
    relayBuild: view.relayBuild,
    rooms: view.rooms,
    room: view.room,
    session: view.session,
    clockState: view.clockState,
    responsiveness: view.responsiveness,
    waitingFor: view.waitingFor,
    delayTicks: view.delayTicks,
    roundTripMs: view.roundTripMs,
    chat: view.chat,
    outOfSync: view instanceof RelayState ? view.outOfSync : view.isOutOfSync,
  };
}

it('brings a mirror fed the client’s messages to the client’s lobby and session state', () => {
  const mirror = new RelayState('guest');
  const client = new RelayClient({
    token: 'token-0123456789abcdef',
    nick: 'guest',
    world: { open: async () => null, restore: async () => null },
    onMessage: (message) => mirror.apply(message),
  });
  client.attach(() => undefined);
  const messages: readonly unknown[] = [
    { kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania', build: 'relay-1' },
    { kind: 'rooms', rooms: [{ id: 'room', name: 'Game', state: 'lobby', members: 1, seats: 1 }] },
    { kind: 'room', room: ROOM },
    { kind: 'chatHistory', lines: [{ from: 'Bartek', text: 'cześć', at: 1 }] },
    { kind: 'chat', from: 'Ania', text: 'hej', at: 2 },
    { kind: 'start', session: SESSION, snapshotTick: null },
    { kind: 'clock', tick: 1, speed: 2, paused: true, by: 'Ania', governed: null },
    { kind: 'responsiveness', mode: 'smooth', bufferTicks: 3, by: 'Bartek' },
    { kind: 'responsiveness', mode: 'auto', bufferTicks: 1, by: 'Ania' },
    { kind: 'delay', ticks: 3 },
    { kind: 'waiting', for: [{ nick: 'Bartek', reason: 'silent', voteAfterMs: 500 }] },
    { kind: 'ping', t: 7, roundTripMs: 42 },
    { kind: 'chat', from: 'Bartek', text: 'gramy', at: 4 },
    { kind: 'desync', tick: 5, domains: ['rng'], reference: 'Bartek' },
    { kind: 'ended', tick: 9, hash: '0000abcd' },
    { kind: 'left' },
  ];
  for (const message of messages) {
    client.receive(message);
    expect(stateOf(mirror)).toEqual(stateOf(client));
  }
});

const line = (n: number): ChatLine => ({ from: 'Ania', text: `line ${n}`, at: n });

it('replaces the chat with the relay’s history and appends each line said after it', () => {
  const state = new RelayState('Ania');
  state.apply({ kind: 'chat', from: 'Ania', text: 'stale', at: 0 });
  state.apply({ kind: 'chatHistory', lines: [line(1), line(2)] });
  expect(state.chat).toEqual([line(1), line(2)]);
  state.apply({ kind: 'chat', ...line(3) });
  expect(state.chat).toEqual([line(1), line(2), line(3)]);
  state.apply({ kind: 'left' });
  expect(state.chat).toEqual([]);
});

it('keeps the newest lines up to the relay’s cap', () => {
  const state = new RelayState('Ania');
  state.apply({
    kind: 'chatHistory',
    lines: Array.from({ length: MAX_CHAT_HISTORY_LINES }, (_, n) => line(n)),
  });
  state.apply({ kind: 'chat', ...line(MAX_CHAT_HISTORY_LINES) });
  expect(state.chat).toHaveLength(MAX_CHAT_HISTORY_LINES);
  expect(state.chat[0]).toEqual(line(1));
  expect(state.chat.at(-1)).toEqual(line(MAX_CHAT_HISTORY_LINES));
});

it('reads the relay build off each welcome', () => {
  const state = new RelayState('Ania');
  state.apply({ kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania', build: 'relay-1' });
  expect(state.relayBuild).toBe('relay-1');
  state.apply({ kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania' });
  expect(state.relayBuild).toBeNull();
});
