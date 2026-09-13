import { describe, expect, it } from 'vitest';
import { openRooms, relayAddress, validNetworkNick } from '../../src/entries/main-menu/network/model.js';

describe('network menu inputs', () => {
  it('accepts only relay endpoints without credentials or fragments', () => {
    expect(relayAddress(' wss://relay.opennorthland.org ')).toBe('wss://relay.opennorthland.org/');
    expect(relayAddress('ws://127.0.0.1:8796/relay?region=local')).toBe(
      'ws://127.0.0.1:8796/relay?region=local',
    );
    for (const raw of [
      'https://example.org',
      'javascript:alert(1)',
      'ws://name:secret@example.org',
      'ws://example.org/#room',
      'no server',
    ])
      expect(relayAddress(raw)).toBeNull();
  });
  it('rejects control characters and oversized names while preserving Unicode names', () => {
    expect(validNetworkNick('Łucja')).toBe(true);
    expect(validNetworkNick('玩家')).toBe(true);
    for (const nick of ['', 'a'.repeat(25), 'a\nb', 'a\u202Eb', '\uD800'])
      expect(validNetworkNick(nick)).toBe(false);
  });
  it('offers join only for rooms that have not started', () => {
    const common = { name: 'Room', members: 2, seats: 4 };
    expect(
      openRooms([
        { ...common, id: 'b', state: 'lobby' },
        { ...common, id: 'a', state: 'running' },
      ]).map((room) => room.id),
    ).toEqual(['b']);
  });
});
