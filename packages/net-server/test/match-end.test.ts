import { TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { SNAPSHOT_REFRESH_MS, SNAPSHOT_RETRY_MS } from '../src/index.js';
import { digest, seatCommand, startedRoom, TOKEN_A, TOKEN_B, TOKEN_C } from './support/message-stage.js';

const hash = '12345678';
const finish = (tick: number, world = 0, result = hash) => ({ kind: 'finish', tick, world, hash: result });
function acknowledged() {
  const s = startedRoom();
  s.advance(TICK_MS);
  for (const p of [s.a, s.b]) p.send({ kind: 'ack', tick: 1, world: 0, digest: digest(1) });
  return s;
}
describe('terminal room consensus', () => {
  it('retires a room explicitly when every connected member reports a different final state', () => {
    const s = acknowledged();
    s.a.send(finish(1));
    s.b.send(finish(1, 0, '87654321'));
    s.advance(1);
    expect(s.a.last('error')?.reason).toMatch(/match result disagreement/);
    expect(s.b.last('left')).toEqual({ kind: 'left' });
    expect(s.relay.roomCount).toBe(0);
    expect(s.a.handle.room).toBeNull();
    expect(s.b.handle.room).toBeNull();
  });
  it('retains an ended room across repeated refresh periods without retaining future paced frames', () => {
    const s = acknowledged();
    s.advance(TICK_MS * 8);
    s.a.send(finish(1));
    s.b.send(finish(1));
    const bytes = Buffer.from('terminal opaque snapshot').toString('base64');
    for (let i = 0; i < 4; i++) {
      s.advance(i === 0 ? 1 : SNAPSHOT_REFRESH_MS);
      const donor = s.a.of('snapshotRequest').length > s.b.of('snapshotRequest').length ? s.a : s.b;
      expect(donor.last('snapshotRequest')).toBeDefined();
      donor.send({ kind: 'blob', type: 'snapshot', tick: 1, to: null, bytes });
      expect(s.relay.roomCount).toBe(1);
      expect(s.a.last('room')?.room.state).toBe('ended');
    }
    s.relay.disconnect(s.b.handle);
    const back = s.introduce(TOKEN_B, 'Bartek');
    back.send({ kind: 'loaded', tick: null });
    expect(back.last('blob')).toMatchObject({ type: 'snapshot', tick: 1, bytes });
    expect(back.of('error')).toEqual([]);
  });
  it('sends no snapshot to a diverged member that left the ended room while it waited', () => {
    const s = startedRoom();
    s.advance(TICK_MS);
    s.b.send({ kind: 'ack', tick: 1, world: 0, digest: digest(2) });
    s.a.send({ kind: 'ack', tick: 1, world: 0, digest: digest(1) });
    s.relay.disconnect(s.b.handle);
    s.a.send(finish(1));
    const back = s.introduce(TOKEN_B, 'Bartek');
    expect(back.last('ended')).toBeDefined();
    back.send({ kind: 'loaded', tick: null });
    back.send({ kind: 'leaveRoom' });
    expect(back.last('left')).toEqual({ kind: 'left' });
    s.a.send({ kind: 'blob', type: 'snapshot', tick: 1, to: null, bytes: 'AAAA' });
    expect(back.of('blob')).toEqual([]);
  });

  it('retries unanswered terminal snapshot donors without advancing the game', () => {
    const s = acknowledged();
    s.a.send(finish(1));
    s.b.send(finish(1));
    s.advance(1);
    expect(s.a.of('snapshotRequest')).toHaveLength(1);
    s.advance(SNAPSHOT_RETRY_MS);
    expect(s.b.of('snapshotRequest')).toHaveLength(1);
    expect(s.a.of('frame')).toHaveLength(1);
  });

  it('ends only on a shared acknowledged result and permanently closes gameplay and joining', () => {
    const s = acknowledged();
    s.a.send(finish(1));
    expect(s.a.last('ended')).toBeUndefined();
    s.b.send(finish(1));
    expect(s.a.last('ended')).toEqual({ kind: 'ended', tick: 1, hash });
    expect(s.a.last('room')?.room.state).toBe('ended');
    const before = s.a.of('frame').length;
    s.advance(TICK_MS * 20);
    expect(s.a.of('frame')).toHaveLength(before);
    for (const command of [
      { kind: 'clock', paused: false },
      seatCommand(0),
      { kind: 'start' },
      { kind: 'kick', player: 1 },
    ])
      s.a.send(command);
    expect(s.a.of('rejected').slice(-4)).toHaveLength(4);
    const c = s.introduce(TOKEN_C, 'Cezary');
    c.send({ kind: 'joinRoom', roomId: s.roomId });
    expect(c.last('rejected')).toBeDefined();
    const kicks = s.b.of('kicked').length;
    s.a.send({ kind: 'leaveRoom' });
    expect(s.b.of('kicked')).toHaveLength(kicks);
    s.b.send({ kind: 'leaveRoom' });
    expect(s.relay.roomCount).toBe(0);
  });
  it('ignores stale generations and rejects future ticks or conflicting result reports', () => {
    const s = acknowledged();
    s.a.send(finish(2));
    expect(s.a.last('rejected')?.reason).toMatch(/acknowledged/);
    s.a.send(finish(1, 9));
    s.b.send(finish(1));
    expect(s.a.last('ended')).toBeUndefined();
    s.a.send(finish(1, 0, '87654321'));
    expect(s.a.last('ended')).toBeUndefined();
    s.a.send(finish(1));
    expect(s.a.last('rejected')?.reason).toMatch(/already reported/);
  });
  it('requires a fresh report after a return even if the snapshot generation is unchanged', () => {
    const s = acknowledged();
    s.a.send(finish(1));
    s.relay.disconnect(s.a.handle);
    const back = s.introduce(TOKEN_A, 'Ania');
    back.send({ kind: 'loaded', tick: 1, world: 0 });
    s.b.send(finish(1));
    expect(back.last('ended')).toBeUndefined();
    back.send(finish(1));
    expect(back.last('ended')).toBeDefined();
  });
  it('does not retain a stale result when its author acknowledges a later tick', () => {
    const s = acknowledged();
    s.a.send(finish(1));
    s.advance(TICK_MS);
    s.a.send({ kind: 'ack', tick: 2, world: 0, digest: digest(1) });
    s.b.send(finish(1));
    expect(s.a.last('ended')).toBeUndefined();
  });
  it('skips a disconnected member and reconnects it to the ended room without reopening it', () => {
    const s = acknowledged();
    s.a.send(finish(1));
    s.relay.disconnect(s.b.handle);
    s.advance(1);
    expect(s.a.last('ended')).toEqual({ kind: 'ended', tick: 1, hash });
    const b = s.introduce('token-b-0123456789ab', 'Bartek');
    expect(b.last('room')?.room.state).toBe('ended');
    expect(b.last('start')).toBeDefined();
    expect(b.last('ended')).toEqual({ kind: 'ended', tick: 1, hash });
    b.send({ kind: 'loaded', tick: 0, world: 0 });
    expect(b.last('frame')?.tick).toBe(1);
    expect(b.last('ended')).toEqual({ kind: 'ended', tick: 1, hash });
    b.send({ kind: 'ack', tick: 1, world: 0, digest: digest(1) });
    b.send(finish(1));
    expect(b.of('rejected')).toEqual([]);
  });
});
