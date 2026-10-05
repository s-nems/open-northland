import type { ServerMessage } from '@open-northland/net-protocol';
import { describe, expect, it, vi } from 'vitest';
import { rejoinProbe } from '../../src/entries/relay/rejoin.js';
import { messages } from '../../src/i18n/index.js';

const WELCOME: ServerMessage = { kind: 'welcome', protocol: 1, nick: 'Ania' };
const ROOM = 'room1';

function rejected(
  code: 'alreadyInRoom' | 'gameStarted' | 'noRoom',
  of: 'joinRoom' | 'loaded' = 'joinRoom',
): ServerMessage {
  return { kind: 'rejected', of, reason: { code } };
}

function probeOf(room: { id: string } | null) {
  const client = { room, joinRoom: vi.fn() };
  return { client, probe: rejoinProbe(client) };
}

describe('the rejoin probe after the link came back', () => {
  it('asks for the running room again on the welcome, and takes being already in it quietly', () => {
    const { client, probe } = probeOf({ id: ROOM });
    expect(probe.observe(WELCOME)).toBe('passed');
    expect(client.joinRoom).toHaveBeenCalledWith(ROOM);
    expect(probe.observe(rejected('alreadyInRoom'))).toBe('consumed');
  });

  it('ends the game of a token the running room removed while it was away', () => {
    const { probe } = probeOf({ id: ROOM });
    probe.observe(WELCOME);
    expect(probe.observe(rejected('gameStarted'))).toEqual({
      kind: 'refused',
      text: messages().net.removedWhileAway,
    });
  });

  it('ends the game when the room is gone', () => {
    const { probe } = probeOf({ id: ROOM });
    probe.observe(WELCOME);
    expect(probe.observe(rejected('noRoom'))).toEqual({
      kind: 'refused',
      text: messages().net.roomGoneWhileAway,
    });
  });

  it('asks nothing without a room, and leaves join refusals it did not cause alone', () => {
    const { client, probe } = probeOf(null);
    expect(probe.observe(WELCOME)).toBe('passed');
    expect(client.joinRoom).not.toHaveBeenCalled();
    expect(probe.observe(rejected('gameStarted'))).toBe('passed');
  });

  it('answers each probe once, and only join refusals', () => {
    const { probe } = probeOf({ id: ROOM });
    probe.observe(WELCOME);
    expect(probe.observe(rejected('gameStarted', 'loaded'))).toBe('passed');
    expect(probe.observe(rejected('alreadyInRoom'))).toBe('consumed');
    expect(probe.observe(rejected('gameStarted'))).toBe('passed');
  });
});
