import { TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { ackThrough, startedRoom, TOKEN_B } from './support/message-stage.js';

const divergentBytes = Buffer.from('divergent snapshot').toString('base64');
const correctedBytes = Buffer.from('corrected snapshot').toString('base64');

describe('snapshot recovery', () => {
  it('keeps a diverged member waiting when a delayed upload is older than the cached snapshot', () => {
    const s = startedRoom();
    s.advance(TICK_MS * 2);
    s.b.send({ kind: 'blob', type: 'snapshot', to: null, tick: 2, bytes: divergentBytes });
    ackThrough(s.a, 1, 2);
    ackThrough(s.b, 1, 1);
    ackThrough(s.b, 2, 2, 2);
    expect(s.b.last('desync')?.tick).toBe(2);

    s.a.send({ kind: 'blob', type: 'snapshot', to: null, tick: 1, bytes: correctedBytes });
    expect(s.b.of('blob')).toEqual([]);
    s.a.send({ kind: 'blob', type: 'snapshot', to: null, tick: 2, bytes: correctedBytes });
    expect(s.b.of('blob')).toHaveLength(1);
    expect(s.b.last('blob')).toMatchObject({ from: 'Ania', tick: 2, bytes: correctedBytes });
  });

  it('replaces a cached snapshot when its author diverges and another donor answers at the same tick', () => {
    const s = startedRoom();
    s.advance(TICK_MS);
    s.b.send({ kind: 'blob', type: 'snapshot', to: null, tick: 1, bytes: divergentBytes });
    ackThrough(s.a, 1, 1);
    ackThrough(s.b, 1, 1, 2);
    expect(s.b.last('desync')?.tick).toBe(1);
    expect(s.a.of('snapshotRequest')).toHaveLength(1);

    s.a.send({ kind: 'blob', type: 'snapshot', to: null, tick: 1, bytes: correctedBytes });
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
});
