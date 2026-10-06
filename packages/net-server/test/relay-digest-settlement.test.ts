import { TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { ackThrough, SEATS, SETTINGS, stage, TOKEN_A, TOKEN_B, TOKEN_C } from './support/message-stage.js';

describe('batched digest settlement', () => {
  it('excludes an earlier minority before choosing a later tick’s reference when a slow member drops', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek');
    const c = s.introduce(TOKEN_C, 'Cezary');
    const slowToken = 'token-d-0123456789ab';
    const slow = s.introduce(slowToken, 'Dorota');
    a.send({
      kind: 'createRoom',
      settings: SETTINGS,
      seats: [...SEATS, { player: 3, mode: 'idle', offers: ['idle', 'ai', 'absent'], color: 3 }],
    });
    const roomId = a.last('room')?.room.id;
    for (const peer of [b, c, slow]) peer.send({ kind: 'joinRoom', roomId });
    a.send({ kind: 'claimSeat', player: 0 });
    b.send({ kind: 'claimSeat', player: 1 });
    c.send({ kind: 'claimSeat', player: 2 });
    slow.send({ kind: 'claimSeat', player: 3 });
    for (const peer of [a, b, c, slow]) peer.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    for (const peer of [a, b, c, slow]) peer.send({ kind: 'loaded', tick: 0, world: 0 });
    s.advance(TICK_MS * 2);
    ackThrough(a, 1, 2, 9);
    ackThrough(b, 1, 2, 1);
    ackThrough(c, 1, 1, 1);
    ackThrough(c, 2, 2, 9);
    for (const peer of [a, b, c, slow]) {
      expect(peer.of('rejected')).toEqual([]);
      expect(peer.of('desync')).toEqual([]);
    }

    s.relay.disconnect(slow.handle);

    expect(a.of('desync')).toEqual([{ kind: 'desync', tick: 1, domains: ['rng'], reference: 'Bartek' }]);
    expect(b.of('desync')).toEqual([]);
    expect(c.of('desync')).toEqual([{ kind: 'desync', tick: 2, domains: ['rng'], reference: 'Bartek' }]);
    expect(b.of('disputed')).toEqual([
      { kind: 'disputed', tick: 1, domains: ['rng'], diverged: ['Ania'] },
      { kind: 'disputed', tick: 2, domains: ['rng'], diverged: ['Cezary'] },
    ]);

    const back = s.introduce(slowToken, 'Dorota');
    back.send({ kind: 'loaded', tick: 0, world: 0 });
    ackThrough(back, 1, 2, 1);
    expect(back.of('rejected')).toEqual([]);
    expect(back.of('desync')).toEqual([]);
  });
});
