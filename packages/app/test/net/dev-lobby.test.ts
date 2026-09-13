import { PROTOCOL_VERSION, type RoomView } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { devLobbyAction } from '../../src/entries/relay/dev-lobby.js';

const COMPATIBILITY = {
  content: 'a'.repeat(64),
  map: 'b'.repeat(64),
  client: 'test',
  protocol: PROTOCOL_VERSION,
};

const SETTINGS: RoomView['settings'] = {
  name: 'las',
  world: { kind: 'map', mapId: 'las' },
  seed: 7,
  rules: { fog: null, progression: null, needs: null },
  speed: 1,
};

function room(overrides: Partial<RoomView>): RoomView {
  return {
    id: 'r1',
    state: 'lobby',
    creator: 'Ania',
    settings: SETTINGS,
    seats: [
      { player: 0, mode: 'ai', color: 0, nick: null, ready: false },
      { player: 1, mode: 'idle', color: 1, nick: null, ready: false },
      { player: 2, mode: 'idle', color: 2, nick: null, ready: false },
    ],
    members: [{ nick: 'Ania', seat: null, connected: true, compatibility: COMPATIBILITY }],
    ...overrides,
  };
}

describe('devLobbyAction', () => {
  it('sits in the first open seat, skipping the AI seats', () => {
    expect(devLobbyAction(room({}), 'Ania', { players: 2 })).toEqual({ kind: 'claimSeat', player: 1 });
  });

  it('gets ready once seated', () => {
    const seated = room({
      seats: [
        { player: 0, mode: 'ai', color: 0, nick: null, ready: false },
        { player: 1, mode: 'human', color: 1, nick: 'Ania', ready: false },
      ],
      members: [{ nick: 'Ania', seat: 1, connected: true, compatibility: COMPATIBILITY }],
    });
    expect(devLobbyAction(seated, 'Ania', { players: 2 })).toEqual({ kind: 'setReady' });
  });

  it('starts as the creator only once the planned people are seated and ready', () => {
    const one = room({
      seats: [{ player: 1, mode: 'human', color: 1, nick: 'Ania', ready: true }],
      members: [{ nick: 'Ania', seat: 1, connected: true, compatibility: COMPATIBILITY }],
    });
    expect(devLobbyAction(one, 'Ania', { players: 2 })).toBeNull();
    const two = room({
      seats: [
        { player: 1, mode: 'human', color: 1, nick: 'Ania', ready: true },
        { player: 2, mode: 'human', color: 2, nick: 'Bartek', ready: false },
      ],
      members: [
        { nick: 'Ania', seat: 1, connected: true, compatibility: COMPATIBILITY },
        { nick: 'Bartek', seat: 2, connected: true, compatibility: COMPATIBILITY },
      ],
    });
    expect(devLobbyAction(two, 'Ania', { players: 2 })).toBeNull();
    const ready = room({
      seats: [
        { player: 1, mode: 'human', color: 1, nick: 'Ania', ready: true },
        { player: 2, mode: 'human', color: 2, nick: 'Bartek', ready: true },
      ],
      members: two.members,
    });
    expect(devLobbyAction(ready, 'Ania', { players: 2 })).toEqual({ kind: 'start' });
    expect(devLobbyAction(ready, 'Bartek', { players: 2 })).toBeNull();
  });

  it('does nothing without an open seat or once the room has started', () => {
    const full = room({
      seats: [{ player: 0, mode: 'human', color: 0, nick: 'Bartek', ready: true }],
      members: [
        { nick: 'Bartek', seat: 0, connected: true, compatibility: COMPATIBILITY },
        { nick: 'Ania', seat: null, connected: true, compatibility: COMPATIBILITY },
      ],
    });
    expect(devLobbyAction(full, 'Ania', { players: 2 })).toBeNull();
    expect(devLobbyAction(room({ state: 'running' }), 'Ania', { players: 2 })).toBeNull();
  });
});
