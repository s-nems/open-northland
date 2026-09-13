import { TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { SEATS, SETTINGS, stage, startedRoom, TOKEN_A, TOKEN_B, TOKEN_C } from './support/message-stage.js';

describe('returning connection state', () => {
  it('holds a replacement connection until its own world is loaded', () => {
    const s = startedRoom();
    s.advance(TICK_MS);
    const back = s.introduce(TOKEN_B, 'Bartek');
    s.advance(TICK_MS);
    expect(back.of('frame')).toEqual([]);
    expect(s.a.last('waiting')?.for).toMatchObject([{ nick: 'Bartek', reason: 'loading' }]);
    back.send({ kind: 'loaded', tick: 1, world: 0 });
    s.advance(TICK_MS);
    expect(back.of('frame').map(({ tick }) => tick)).toEqual([2]);
  });

  it('replays an unchanged wait for another member after reconnecting', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek');
    const c = s.introduce(TOKEN_C, 'Cezary');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    const roomId = a.last('room')?.room.id ?? '';
    b.send({ kind: 'joinRoom', roomId });
    c.send({ kind: 'joinRoom', roomId });
    for (const [player, peer] of [a, b, c].entries()) {
      peer.send({ kind: 'claimSeat', player });
    }
    for (const peer of [a, b, c]) peer.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    for (const peer of [a, b, c]) peer.send({ kind: 'loaded', tick: 0, world: 0 });
    s.relay.disconnect(c.handle);
    s.advance(TICK_MS);
    s.relay.disconnect(b.handle);
    const back = s.introduce(TOKEN_B, 'Bartek');
    back.send({ kind: 'loaded', tick: 0, world: 0 });
    expect(back.last('waiting')?.for).toMatchObject([{ nick: 'Cezary', reason: 'gone' }]);
  });
});
