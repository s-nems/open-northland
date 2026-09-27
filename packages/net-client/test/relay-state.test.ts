import type { GameSession } from '@open-northland/lockstep';
import { RelayClient, RelayState } from '@open-northland/net-client';
import { PROTOCOL_VERSION, type RoomView } from '@open-northland/net-protocol';
import { expect, it } from 'vitest';

const SESSION: GameSession = {
  world: { kind: 'map', mapId: 'test' },
  seed: 3,
  seats: [{ player: 0, mode: 'human', color: 0 }],
  localSeat: 0,
  rules: { fog: null, progression: null, needs: null },
  speed: 1,
};

const ROOM: RoomView = {
  id: 'room',
  state: 'running',
  creator: 'Ania',
  settings: { name: 'Game', world: SESSION.world, seed: 3, speed: 1, rules: SESSION.rules },
  seats: [{ player: 0, mode: 'human', offers: ['idle'], color: 0, nick: 'Ania', ready: true }],
  members: [{ nick: 'Ania', seat: 0, connected: true, compatibility: null, load: null }],
};

function stateOf(view: RelayClient | RelayState) {
  return {
    nick: view.nick,
    welcomed: view.welcomed,
    rooms: view.rooms,
    room: view.room,
    session: view.session,
    clockState: view.clockState,
    waitingFor: view.waitingFor,
    delayTicks: view.delayTicks,
    roundTripMs: view.roundTripMs,
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
    { kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania' },
    { kind: 'rooms', rooms: [{ id: 'room', name: 'Game', state: 'lobby', members: 1, seats: 1 }] },
    { kind: 'room', room: ROOM },
    { kind: 'start', session: SESSION, snapshotTick: null },
    { kind: 'clock', tick: 1, speed: 2, paused: true, by: 'Ania', governed: null },
    { kind: 'delay', ticks: 3 },
    { kind: 'waiting', for: [{ nick: 'Bartek', reason: 'slow', voteAfterMs: 500 }] },
    { kind: 'ping', t: 7, roundTripMs: 42 },
    { kind: 'desync', tick: 5, domains: ['rng'], reference: 'Bartek' },
    { kind: 'ended', tick: 9, hash: '0000abcd' },
    { kind: 'left' },
  ];
  for (const message of messages) {
    client.receive(message);
    expect(stateOf(mirror)).toEqual(stateOf(client));
  }
});
