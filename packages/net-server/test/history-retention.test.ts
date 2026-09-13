import { TICK_MS, type WireFrame } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { CatchUpStore, MAX_HISTORY_AGE_MS, MAX_HISTORY_BYTES } from '../src/relay/catch-up.js';
import { SNAPSHOT_REFRESH_MS, SNAPSHOT_RETRY_MS } from '../src/relay/resync.js';
import {
  ackThrough,
  type MessageStage,
  type Peer,
  SEATS,
  SETTINGS,
  startedRoom,
  TOKEN_B,
  TOKEN_C,
} from './support/message-stage.js';

const BLOB = Buffer.from('opaque snapshot').toString('base64');

function play(s: MessageStage, peers: readonly Peer[], seconds: number): void {
  const acked = new Map(peers.map((peer) => [peer, peer.last('frame')?.tick ?? 0]));
  for (let second = 0; second < seconds; second++) {
    s.advance(1000);
    for (const peer of peers) {
      const ping = peer.last('ping');
      if (ping !== undefined) peer.send({ kind: 'pong', t: ping.t });
      if (peer.of('left').length > 0) continue;
      const tick = peer.last('frame')?.tick ?? 0;
      ackThrough(peer, (acked.get(peer) ?? 0) + 1, tick, 1, peer.last('blob')?.tick ?? 0);
      acked.set(peer, tick);
    }
  }
}

function snapshot(peer: Peer): void {
  peer.send({ kind: 'blob', type: 'snapshot', to: null, tick: peer.last('frame')?.tick ?? 1, bytes: BLOB });
}

describe('catch-up retention budgets', () => {
  it('refuses overflow before retaining it, then frees byte capacity when a snapshot prunes frames', () => {
    const store = new CatchUpStore();
    const command = { kind: 'opaque', payload: 'ą'.repeat(400) };
    const commands = Array.from({ length: 240 }, (_, sequence) => ({
      sequence,
      envelope: { v: 1, origin: 'player' as const, player: 0, command },
    }));
    let tick = 1;
    let last: WireFrame = { tick, commands };
    while (store.record(last, tick)) {
      expect(store.bytes).toBeLessThanOrEqual(MAX_HISTORY_BYTES);
      tick++;
      last = { tick, commands };
    }
    const retained = store.bytes;
    expect(retained).toBeGreaterThan(MAX_HISTORY_BYTES / 2);
    expect(store.framesAfter(0)).toHaveLength(tick - 1);
    expect(store.framesAfter(0)?.at(-1)?.tick).toBe(tick - 1);
    expect(store.cache({ tick: tick - 1, from: 'Ania', bytes: BLOB })).toBe(true);
    expect(store.bytes).toBe(0);
    expect(store.record(last, tick)).toBe(true);
    expect(store.framesAfter(tick - 2)).toBeNull();
    expect(store.framesAfter(tick - 1)).toEqual([last]);
  });

  it('ends a command-heavy room before exceeding its byte budget and requests snapshots before the limit', () => {
    const s = startedRoom();
    play(s, [s.a, s.b], 1);
    const envelope = {
      v: 1,
      origin: 'player',
      player: 0,
      command: { kind: 'opaque', text: 'x'.repeat(800) },
    };
    for (let step = 0; step < 1000 && s.relay.roomCount > 0; step++) {
      const currentTick = s.a.last('frame')?.tick ?? 0;
      for (const peer of [s.a, s.b]) {
        for (let command = 0; command < 20; command++) {
          peer.send({ kind: 'command', envelope, fromTick: 0 });
        }
      }
      s.advance(TICK_MS);
      for (const peer of [s.a, s.b]) {
        if (peer.of('left').length > 0) continue;
        const ping = peer.last('ping');
        if (ping !== undefined) peer.send({ kind: 'pong', t: ping.t });
        ackThrough(peer, currentTick + 1, currentTick + 1);
      }
    }
    expect(s.a.last('error')?.reason).toMatch(/history byte limit/);
    expect(s.relay.roomCount).toBe(0);
    expect(s.a.of('rejected')).toEqual([]);
    expect(s.a.of('snapshotRequest').length).toBeGreaterThan(0);
    expect(s.b.of('snapshotRequest').length).toBeGreaterThan(0);
    const frames = s.a.of('frame');
    const bytes = frames.reduce(
      (total, { tick, commands }) => total + Buffer.byteLength(JSON.stringify({ tick, commands })),
      0,
    );
    expect(bytes).toBeLessThanOrEqual(MAX_HISTORY_BYTES);
    expect(bytes).toBeGreaterThan(MAX_HISTORY_BYTES * 0.99);
    expect(frames.map(({ tick }) => tick)).toEqual(frames.map((_, i) => i + 1));
    s.a.send({ kind: 'joinRoom', roomId: s.roomId });
    expect(s.a.last('rejected')?.reason).toMatch(/no room/);
  });

  it('ends an unrefreshed room by age, releases memberships and leaves another room running', () => {
    const s = startedRoom();
    const c = s.introduce(TOKEN_C, 'Cezary');
    c.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    c.send({ kind: 'claimSeat', player: 0 });
    c.send({ kind: 'setReady', ready: true });
    c.send({ kind: 'start' });
    c.send({ kind: 'loaded', tick: 0, world: 0 });
    for (let elapsed = 0; elapsed < MAX_HISTORY_AGE_MS + 1000; elapsed += 1000) {
      if (elapsed === MAX_HISTORY_AGE_MS - 10_000) s.relay.disconnect(s.b.handle);
      play(s, [s.a, s.b, c], 1);
      if (elapsed % 10_000 === 0) snapshot(c);
    }
    expect(s.a.last('error')?.reason).toMatch(/history age limit/);
    expect(s.a.last('left')).toEqual({ kind: 'left' });
    expect(s.b.last('left')).toBeUndefined();
    expect(s.relay.roomCount).toBe(1);
    expect(c.of('error')).toEqual([]);
    const tick = c.last('frame')?.tick ?? 0;
    play(s, [c], 1);
    expect(c.last('frame')?.tick).toBeGreaterThan(tick);
    const returned = s.introduce(TOKEN_B, 'Bartek');
    expect(returned.of('start')).toEqual([]);
    returned.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    expect(returned.last('room')?.room.state).toBe('lobby');
    expect(s.relay.roomCount).toBe(2);
  });

  it('accepts a same-tick refresh while paused without retrying a satisfied request', () => {
    const s = startedRoom();
    play(s, [s.a, s.b], 1);
    snapshot(s.a);
    s.a.send({ kind: 'clock', paused: true });
    play(s, [s.a, s.b], SNAPSHOT_REFRESH_MS / 1000);
    expect(s.a.of('snapshotRequest')).toHaveLength(1);
    snapshot(s.a);
    play(s, [s.a, s.b], SNAPSHOT_RETRY_MS / 1000);
    expect(s.a.of('snapshotRequest')).toHaveLength(1);
    expect(s.b.of('snapshotRequest')).toHaveLength(0);
    expect(s.relay.roomCount).toBe(1);
  });

  it('retries a periodic refresh with another donor and preserves reconnect replay after its snapshot', () => {
    const s = startedRoom();
    play(s, [s.a, s.b], SNAPSHOT_REFRESH_MS / 1000);
    expect(s.a.of('snapshotRequest')).toHaveLength(1);
    expect(s.b.of('snapshotRequest')).toHaveLength(0);
    play(s, [s.a, s.b], SNAPSHOT_RETRY_MS / 1000);
    expect(s.b.of('snapshotRequest')).toHaveLength(1);
    snapshot(s.b);
    const cachedTick = s.b.last('frame')?.tick ?? 0;
    play(s, [s.a, s.b], 1);
    const currentTick = s.a.last('frame')?.tick ?? 0;
    s.relay.disconnect(s.b.handle);
    const back = s.introduce(TOKEN_B, 'Bartek');
    back.send({ kind: 'loaded', tick: 0, world: 0 });
    expect(back.last('blob')).toMatchObject({ tick: cachedTick, bytes: BLOB });
    expect(back.of('frame').map(({ tick }) => tick)).toEqual(
      Array.from({ length: currentTick - cachedTick }, (_, i) => cachedTick + i + 1),
    );
    ackThrough(back, cachedTick + 1, currentTick, 1, cachedTick);
    s.advance(TICK_MS);
    expect(back.of('rejected')).toEqual([]);
    expect(s.relay.roomCount).toBe(1);
    ackThrough(s.a, currentTick + 1, currentTick + 1);
    ackThrough(back, currentTick + 1, currentTick + 1, 1, cachedTick);
    play(s, [s.a, back], SNAPSHOT_REFRESH_MS / 1000);
    expect(s.now()).toBeGreaterThan(MAX_HISTORY_AGE_MS);
    expect(s.relay.roomCount).toBe(1);
  });
});
