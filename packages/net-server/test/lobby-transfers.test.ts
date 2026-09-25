import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TEST_COMPATIBILITY } from './support/compatibility.js';
import { SEATS, SETTINGS, stage, TOKEN_A, TOKEN_B } from './support/message-stage.js';

const bytes = Buffer.from('opaque save').toString('base64');
const identity = { fingerprint: createHash('sha256').update(bytes).digest('hex'), tick: 73 };
function lobby() {
  const s = stage();
  const a = s.introduce(TOKEN_A, 'Ania');
  const b = s.introduce(TOKEN_B, 'Bartek');
  a.send({
    kind: 'createRoom',
    settings: { ...SETTINGS, initialSave: identity, mapOrigin: 'user' },
    seats: SEATS,
  });
  b.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id });
  a.send({ kind: 'claimSeat', player: 0 });
  b.send({ kind: 'claimSeat', player: 1 });
  for (const p of [a, b])
    p.send({
      kind: 'setCompatibility',
      compatibility: { ...TEST_COMPATIBILITY, save: identity.fingerprint },
    });
  return { ...s, a, b };
}
const upload = { kind: 'blob', type: 'initialSave', to: null, tick: identity.tick, bytes };
describe('immutable lobby files', () => {
  it('requires the exact creator upload and every save report before readiness', () => {
    const { a, b } = lobby();
    a.send({ kind: 'setReady', ready: true });
    expect(a.last('rejected')?.reason).toMatch(/upload missing/);
    b.send(upload);
    expect(b.last('rejected')?.reason).toMatch(/only the creator/);
    a.send({ ...upload, bytes: Buffer.from('different').toString('base64') });
    expect(a.last('rejected')?.reason).toMatch(/fingerprint mismatch/);
    a.send(upload);
    b.send({ kind: 'setCompatibility', compatibility: TEST_COMPATIBILITY });
    a.send({ kind: 'setReady', ready: true });
    expect(a.last('rejected')?.reason).toMatch(/Bartek: save/);
  });
  it('starts at the declared saved tick and serves cached bytes instead of fresh tick zero', () => {
    const { a, b } = lobby();
    a.send(upload);
    for (const p of [a, b]) p.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    expect(a.last('start')).toMatchObject({ snapshotTick: 73, session: { initialSave: identity } });
    a.send({ kind: 'loaded', tick: 0, world: 73 });
    expect(a.last('rejected')?.reason).toMatch(/tick 73/);
    b.send({ kind: 'loaded', tick: null, world: 0 });
    expect(b.last('blob')).toMatchObject({ type: 'snapshot', tick: 73, bytes });
  });
  it('retains the pinned initial save after its creator leaves', () => {
    const { a, b } = lobby();
    a.send(upload);
    a.send({ kind: 'leaveRoom' });
    b.send({ kind: 'requestInitialSave' });
    expect(b.last('blob')).toMatchObject({ type: 'initialSave', tick: 73, bytes });
  });
  it('lets the creator resolve vacant saved seats without changing their teams or colors', () => {
    const { a, b } = lobby();
    a.send({ kind: 'setSeat', player: 2, mode: 'idle' });
    expect(a.last('room')?.room.seats.find((seat) => seat.player === 2)?.mode).toBe('idle');
    b.send({ kind: 'setSeat', player: 2, mode: 'ai' });
    expect(b.last('rejected')?.reason).toMatch(/creator/);
    a.send({ kind: 'setSeat', player: 2, team: 1 });
    expect(a.last('rejected')?.reason).toMatch(/saved seat/);
    a.send({ kind: 'setSeat', player: 2, mode: 'ai' });
    expect(a.last('room')?.room.seats.find((seat) => seat.player === 2)?.mode).toBe('ai');
    a.send({ kind: 'setSeat', player: 2, mode: 'absent' });
    expect(a.last('rejected')?.reason).toMatch(/saved world/);
  });
  it('locks saved overrides and routes map retries to the current creator', () => {
    const { a, b, advance } = lobby();
    a.send({ kind: 'setSeat', player: 2, color: 3 });
    expect(a.last('rejected')?.reason).toMatch(/saved seat/);
    a.send({ kind: 'setSettings', settings: { ...SETTINGS, seed: 9, world: undefined } });
    expect(a.last('rejected')?.reason).toMatch(/saved/);
    b.send({ kind: 'requestMap' });
    expect(a.last('mapRequest')).toEqual({ kind: 'mapRequest', from: 'Bartek' });
    b.send({ kind: 'requestMap' });
    expect(b.last('rejected')?.reason).toMatch(/too soon/);
    expect(a.of('mapRequest')).toHaveLength(1);
    advance(2000);
    b.send({ kind: 'requestMap' });
    expect(a.of('mapRequest')).toHaveLength(2);
    b.send({ kind: 'blob', type: 'map', tick: null, to: null, bytes });
    expect(b.last('rejected')?.reason).toMatch(/creator/);
  });
});
