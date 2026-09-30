import { TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { ackThrough, roomOfThree, startedRoom, TOKEN_A, TOKEN_B, TOKEN_C } from './support/message-stage.js';

const divergentBytes = Buffer.from('divergent snapshot').toString('base64');
const correctedBytes = Buffer.from('corrected snapshot').toString('base64');

describe('snapshot recovery', () => {
  it('accepts a newer snapshot captured from the corrected world', () => {
    const s = startedRoom();
    s.advance(TICK_MS * 2);
    ackThrough(s.a, 1, 1);
    ackThrough(s.b, 1, 1, 2);
    s.a.send({ kind: 'blob', type: 'snapshot', to: null, tick: 1, world: 0, bytes: correctedBytes });
    ackThrough(s.a, 2, 2);
    ackThrough(s.b, 2, 2, 1, 1);
    s.b.send({ kind: 'blob', type: 'snapshot', to: null, tick: 2, world: 1, bytes: correctedBytes });

    s.relay.disconnect(s.a.handle);
    const back = s.introduce(TOKEN_A, 'Ania');
    back.send({ kind: 'loaded', tick: null });
    expect(back.last('blob')).toMatchObject({ from: 'Bartek', tick: 2, bytes: correctedBytes });
    expect(back.of('frame')).toEqual([]);
    expect(s.b.of('rejected')).toEqual([]);
  });

  it('ignores a newer upload from the world a donor discarded during resync', () => {
    const s = startedRoom();
    s.advance(TICK_MS * 2);
    ackThrough(s.a, 1, 1);
    ackThrough(s.b, 1, 1, 2);
    s.a.send({ kind: 'blob', type: 'snapshot', to: null, tick: 1, world: 0, bytes: correctedBytes });
    expect(s.b.last('blob')).toMatchObject({ tick: 1, bytes: correctedBytes });

    // This upload was sent before the verdict and arrived after the corrected world was served.
    s.b.send({ kind: 'blob', type: 'snapshot', to: null, tick: 2, world: 0, bytes: divergentBytes });
    s.relay.disconnect(s.b.handle);
    const back = s.introduce(TOKEN_B, 'Bartek');
    back.send({ kind: 'loaded', tick: null });
    expect(back.last('blob')).toMatchObject({ from: 'Ania', tick: 1, bytes: correctedBytes });
    expect(back.of('frame').map(({ tick }) => tick)).toEqual([2]);
    expect(s.b.of('rejected')).toEqual([]);
  });

  it('retains the corrected cache when an obsolete same-tick upload arrives after resync', () => {
    const s = startedRoom();
    s.advance(TICK_MS);
    s.b.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: 1, bytes: divergentBytes });
    ackThrough(s.a, 1, 1);
    ackThrough(s.b, 1, 1, 2);
    s.a.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: 1, bytes: correctedBytes });
    expect(s.b.last('blob')).toMatchObject({ from: 'Ania', tick: 1, bytes: correctedBytes });

    // Compressed before the verdict, but delivered after the relay served the replacement.
    s.b.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: 1, bytes: divergentBytes });
    s.relay.disconnect(s.b.handle);
    const back = s.introduce(TOKEN_B, 'Bartek');
    back.send({ kind: 'loaded', tick: null });
    expect(back.last('blob')).toMatchObject({ from: 'Ania', tick: 1, bytes: correctedBytes });
  });

  it('keeps a reconnect waiting when the cached donor has diverged', () => {
    const s = startedRoom();
    s.advance(TICK_MS);
    s.b.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: 1, bytes: divergentBytes });
    ackThrough(s.a, 1, 1);
    ackThrough(s.b, 1, 1, 2);
    expect(s.b.last('desync')?.tick).toBe(1);
    s.relay.disconnect(s.b.handle);
    const back = s.introduce(TOKEN_B, 'Bartek');
    back.send({ kind: 'loaded', tick: null });
    expect(back.of('blob')).toEqual([]);

    s.a.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: 1, bytes: correctedBytes });
    expect(back.last('blob')).toMatchObject({ from: 'Ania', tick: 1, bytes: correctedBytes });
    expect(back.of('rejected')).toEqual([]);
  });

  it('keeps a diverged member waiting when a delayed upload is older than the cached snapshot', () => {
    const s = startedRoom();
    s.advance(TICK_MS * 2);
    s.b.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: 2, bytes: divergentBytes });
    ackThrough(s.a, 1, 2);
    ackThrough(s.b, 1, 1);
    ackThrough(s.b, 2, 2, 2);
    expect(s.b.last('desync')?.tick).toBe(2);

    s.a.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: 1, bytes: correctedBytes });
    expect(s.b.of('blob')).toEqual([]);
    s.a.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: 2, bytes: correctedBytes });
    expect(s.b.of('blob')).toHaveLength(1);
    expect(s.b.last('blob')).toMatchObject({ from: 'Ania', tick: 2, bytes: correctedBytes });
  });

  it('replaces a cached snapshot when its author diverges and another donor answers at the same tick', () => {
    const s = startedRoom();
    s.advance(TICK_MS);
    s.b.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: 1, bytes: divergentBytes });
    ackThrough(s.a, 1, 1);
    ackThrough(s.b, 1, 1, 2);
    expect(s.b.last('desync')?.tick).toBe(1);
    expect(s.a.of('snapshotRequest')).toHaveLength(1);

    s.a.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: 1, bytes: correctedBytes });
    expect(s.b.last('blob')).toMatchObject({ from: 'Ania', tick: 1, bytes: correctedBytes });

    s.advance(TICK_MS);
    ackThrough(s.a, 2, 2);
    ackThrough(s.b, 2, 2, 1, 1);
    expect(s.b.of('desync')).toHaveLength(1);
    expect(s.b.of('rejected')).toEqual([]);
    s.relay.disconnect(s.b.handle);
    const back = s.introduce(TOKEN_B, 'Bartek');
    back.send({ kind: 'loaded', tick: null });
    expect(back.last('blob')).toMatchObject({ from: 'Ania', tick: 1, bytes: correctedBytes });
    expect(back.of('frame').map(({ tick }) => tick)).toEqual([2]);
  });

  it("holds a returning member off a diverged donor's cache until nobody in sync can replace it", () => {
    const s = roomOfThree();
    s.advance(TICK_MS);
    s.b.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: 1, bytes: divergentBytes });
    ackThrough(s.a, 1, 1);
    ackThrough(s.c, 1, 1);
    ackThrough(s.b, 1, 1, 2);
    expect(s.b.last('desync')?.tick).toBe(1);
    s.relay.disconnect(s.c.handle);
    const back = s.introduce(TOKEN_C, 'Cezary');
    back.send({ kind: 'loaded', tick: null });
    expect(back.of('blob')).toEqual([]);

    // The last member in sync drops before answering: the cache is the best world left.
    s.relay.disconnect(s.a.handle);
    s.advance(1);
    expect(back.last('blob')).toMatchObject({ from: 'Bartek', tick: 1, bytes: divergentBytes });
    expect(back.of('snapshotRequest')).toHaveLength(1);
    back.send({ kind: 'blob', type: 'snapshot', world: 1, to: null, tick: 1, bytes: correctedBytes });
    expect(s.b.last('blob')).toMatchObject({ from: 'Cezary', tick: 1, bytes: correctedBytes });
    expect(back.of('rejected')).toEqual([]);
  });

  it("serves a reloading reference the diverged donor's cache when nobody else is in sync", () => {
    const s = startedRoom();
    s.advance(TICK_MS);
    s.b.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: 1, bytes: divergentBytes });
    ackThrough(s.a, 1, 1);
    ackThrough(s.b, 1, 1, 2);
    expect(s.a.of('snapshotRequest')).toHaveLength(1);
    s.relay.disconnect(s.a.handle);
    const back = s.introduce(TOKEN_A, 'Ania');
    back.send({ kind: 'loaded', tick: null });
    expect(back.last('blob')).toMatchObject({ from: 'Bartek', tick: 1, bytes: divergentBytes });

    s.advance(1);
    expect(back.of('snapshotRequest')).toHaveLength(1);
    back.send({ kind: 'blob', type: 'snapshot', world: 1, to: null, tick: 1, bytes: correctedBytes });
    expect(s.b.last('blob')).toMatchObject({ from: 'Ania', tick: 1, bytes: correctedBytes });
    expect(back.of('rejected')).toEqual([]);
  });
});
