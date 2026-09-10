import { describe, expect, it } from 'vitest';
import { relayPlan, searchWithRoom } from '../../src/entries/relay/plan.js';

describe('relayPlan', () => {
  it('joins a room by id over a ws or wss url', () => {
    expect(relayPlan(new URLSearchParams('relay=ws://localhost:8765&room=ab12'))).toEqual({
      url: 'ws://localhost:8765/',
      room: { kind: 'join', id: 'ab12' },
    });
    expect(relayPlan(new URLSearchParams('relay=wss://relay.example.org/&room=ab12'))?.url).toBe(
      'wss://relay.example.org/',
    );
  });

  it('creates a room for a map, waiting for the planned people', () => {
    expect(relayPlan(new URLSearchParams('relay=ws://localhost:8765&room=new&map=las&players=3'))).toEqual({
      url: 'ws://localhost:8765/',
      room: { kind: 'create', mapId: 'las', players: 3 },
    });
    expect(relayPlan(new URLSearchParams('relay=ws://localhost:8765&room=new&map=las'))?.room).toMatchObject({
      players: 2,
    });
  });

  it('refuses another scheme, a missing room, or a new room without a map', () => {
    expect(relayPlan(new URLSearchParams('relay=http://localhost:8765&room=ab12'))).toBeNull();
    expect(relayPlan(new URLSearchParams('relay=ws://localhost:8765'))).toBeNull();
    expect(relayPlan(new URLSearchParams('relay=ws://localhost:8765&room=new'))).toBeNull();
    expect(relayPlan(new URLSearchParams('relay=nonsense&room=ab12'))).toBeNull();
  });

  it('pins the created room into the search, keeping the rest', () => {
    const params = new URLSearchParams('relay=ws://localhost:8765&room=new&map=las&players=2&lang=pol');
    expect(searchWithRoom(params, 'c0ffee')).toBe(
      '?relay=ws%3A%2F%2Flocalhost%3A8765&room=c0ffee&map=las&players=2&lang=pol',
    );
  });
});
