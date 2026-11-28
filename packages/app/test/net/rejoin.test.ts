import { PROTOCOL_VERSION, type RoomView, type ServerMessage } from '@open-northland/net-protocol';
import { describe, expect, it, vi } from 'vitest';
import { rejoinProbe } from '../../src/net/rejoin.js';

const WELCOME: ServerMessage = { kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania' };
const STARTED: Pick<RoomView, 'id' | 'state'> = { id: 'room1', state: 'running' };

function rejected(
  code: 'alreadyInRoom' | 'gameStarted' | 'noRoom',
  of: 'joinRoom' | 'loaded' = 'joinRoom',
): ServerMessage {
  return { kind: 'rejected', of, reason: { code } };
}

function probeOf(room: Pick<RoomView, 'id' | 'state'> | null) {
  const client = { room, joinRoom: vi.fn() };
  return { client, probe: rejoinProbe(client) };
}

describe('the rejoin probe after the link came back', () => {
  it('asks for the started room again on the welcome, and takes being already in it quietly', () => {
    const { client, probe } = probeOf(STARTED);
    expect(probe(WELCOME)).toBe('passed');
    expect(client.joinRoom).toHaveBeenCalledWith('room1');
    expect(probe(rejected('alreadyInRoom'))).toBe('consumed');
  });

  it('hands back the refusal of a token the room removed, or of a room that is gone', () => {
    for (const code of ['gameStarted', 'noRoom'] as const) {
      const { probe } = probeOf(STARTED);
      probe(WELCOME);
      expect(probe(rejected(code))).toEqual({ refused: { code } });
    }
  });

  it('asks nothing for a lobby room or none, and leaves join refusals it did not cause alone', () => {
    for (const room of [null, { id: 'room1', state: 'lobby' as const }]) {
      const { client, probe } = probeOf(room);
      expect(probe(WELCOME)).toBe('passed');
      expect(client.joinRoom).not.toHaveBeenCalled();
      expect(probe(rejected('gameStarted'))).toBe('passed');
    }
  });

  it('swallows an already-in-room answer to any join while a room is held, and only join refusals', () => {
    const { probe } = probeOf(STARTED);
    expect(probe(rejected('alreadyInRoom'))).toBe('consumed');
    probe(WELCOME);
    expect(probe(rejected('gameStarted', 'loaded'))).toBe('passed');
    expect(probe(rejected('alreadyInRoom'))).toBe('consumed');
    expect(probe(rejected('gameStarted'))).toBe('passed');
  });
});
