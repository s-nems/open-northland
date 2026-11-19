import { TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import {
  digest,
  LOAD,
  seatCommand,
  startedRoom,
  TOKEN_A,
  TOKEN_B,
  TOKEN_C,
} from '../../support/message-stage.js';

const hash = '12345678';
const finish = (tick: number, world = 0, result = hash) => ({ kind: 'finish', tick, world, hash: result });
function acknowledged() {
  const s = startedRoom();
  s.advance(TICK_MS);
  for (const p of [s.a, s.b]) p.send({ kind: 'ack', load: LOAD, tick: 1, world: 0, digest: digest(1) });
  return s;
}
describe('terminal room consensus', () => {
  it('retires a room explicitly when every connected member reports a different final state', () => {
    const s = acknowledged();
    s.a.send(finish(1));
    s.b.send(finish(1, 0, '87654321'));
    s.advance(1);
    expect(s.a.last('error')?.reason).toEqual({ code: 'resultDisagreement' });
    expect(s.b.last('left')).toEqual({ kind: 'left' });
    expect(s.relay.roomCount).toBe(0);
    expect(s.a.handle.room).toBeNull();
    expect(s.b.handle.room).toBeNull();
  });
  it('sends no snapshot to a diverged member that left the room past its result while it waited', () => {
    const s = startedRoom();
    s.advance(TICK_MS);
    s.b.send({ kind: 'ack', load: LOAD, tick: 1, world: 0, digest: digest(2) });
    s.a.send({ kind: 'ack', load: LOAD, tick: 1, world: 0, digest: digest(1) });
    s.relay.disconnect(s.b.handle);
    s.a.send(finish(1));
    const back = s.introduce(TOKEN_B, 'Bartek');
    expect(back.last('ended')).toBeDefined();
    back.send({ kind: 'loaded', tick: null });
    back.send({ kind: 'leaveRoom' });
    expect(back.last('left')).toEqual({ kind: 'left' });
    s.a.send({ kind: 'blob', type: 'snapshot', world: 0, tick: 1, to: null, bytes: 'AAAA' });
    expect(back.of('blob')).toEqual([]);
  });

  it('confirms only a shared acknowledged result, and the game runs on past it', () => {
    const s = acknowledged();
    s.a.send(finish(1));
    expect(s.a.last('ended')).toBeUndefined();
    s.b.send(finish(1));
    expect(s.a.last('ended')).toEqual({ kind: 'ended', tick: 1, hash });
    expect(s.a.last('room')?.room.state).toBe('running');
    const before = s.a.of('frame').length;
    s.a.send(seatCommand(0, 7));
    s.a.send({ kind: 'clock', speed: 2 });
    s.advance(TICK_MS * 4);
    expect(s.a.of('rejected')).toEqual([]);
    expect(s.a.of('frame').length).toBeGreaterThan(before);
    expect(s.a.of('frame').flatMap((frame) => frame.commands.map((command) => command.envelope))).toEqual([
      expect.objectContaining({ command: expect.objectContaining({ value: 7 }) }),
    ]);
    // A world that catches up passes the decided result again; that is not a new one.
    s.b.send(finish(1));
    expect(s.b.of('rejected')).toEqual([]);
    const c = s.introduce(TOKEN_C, 'Cezary');
    c.send({ kind: 'joinRoom', roomId: s.roomId });
    expect(c.last('rejected')?.reason).toEqual({ code: 'gameStarted' });
    s.a.send({ kind: 'leaveRoom' });
    expect(s.b.last('kicked')).toMatchObject({ player: 0, nick: 'Ania', cause: 'left', mode: 'idle' });
    s.b.send({ kind: 'leaveRoom' });
    expect(s.relay.roomCount).toBe(0);
  });
  it('ignores stale generations and rejects future ticks or conflicting result reports', () => {
    const s = acknowledged();
    s.a.send(finish(2));
    expect(s.a.last('rejected')?.reason).toEqual({ code: 'resultTickUnacknowledged' });
    s.a.send(finish(1, 9));
    s.b.send(finish(1));
    expect(s.a.last('ended')).toBeUndefined();
    s.a.send(finish(1, 0, '87654321'));
    expect(s.a.last('ended')).toBeUndefined();
    s.a.send(finish(1));
    expect(s.a.last('rejected')?.reason).toEqual({ code: 'resultAlreadyReported' });
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
    s.a.send({ kind: 'ack', load: LOAD, tick: 2, world: 0, digest: digest(1) });
    s.b.send(finish(1));
    expect(s.a.last('ended')).toBeUndefined();
  });
  it('skips a disconnected member and gives it the result when it comes back', () => {
    const s = acknowledged();
    s.a.send(finish(1));
    s.relay.disconnect(s.b.handle);
    s.advance(1);
    expect(s.a.last('ended')).toEqual({ kind: 'ended', tick: 1, hash });
    const b = s.introduce('token-b-0123456789ab', 'Bartek');
    expect(b.last('room')?.room.state).toBe('running');
    expect(b.last('start')).toBeDefined();
    expect(b.last('ended')).toEqual({ kind: 'ended', tick: 1, hash });
    b.send({ kind: 'loaded', tick: 0, world: 0 });
    expect(b.of('frame').map((frame) => frame.tick)).toEqual(s.a.of('frame').map((frame) => frame.tick));
    expect(b.last('ended')).toEqual({ kind: 'ended', tick: 1, hash });
    b.send({ kind: 'ack', load: LOAD, tick: 1, world: 0, digest: digest(1) });
    b.send(finish(1));
    expect(b.of('rejected')).toEqual([]);
  });
});
