import { TICK_MS, type WireFrame } from '@open-northland/net-protocol';
import { parseCommandEnvelope } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { CatchUpStore, MAX_HISTORY_AGE_MS, MAX_HISTORY_BYTES } from '../src/relay/catch-up.js';
import { SNAPSHOT_REFRESH_MS, SNAPSHOT_RETRY_MS } from '../src/relay/resync.js';
import {
  ackThrough,
  type MessageStage,
  type Peer,
  SEATS,
  SETTINGS,
  stage,
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
  peer.send({
    kind: 'blob',
    type: 'snapshot',
    world: 0,
    to: null,
    tick: peer.last('frame')?.tick ?? 1,
    bytes: BLOB,
  });
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

  it('returns the exact replay tail at snapshot, frame and terminal boundaries', () => {
    const store = new CatchUpStore();
    store.cache({ tick: 10, from: 'Ania', bytes: BLOB });
    const frames = Array.from({ length: 5 }, (_, i) => ({ tick: i + 11, commands: [] }));
    for (const frame of frames) store.record(frame, 0);
    expect(store.framesAfter(9)).toBeNull();
    for (let tick = 10; tick <= 16; tick++)
      expect(store.framesAfter(tick)).toEqual(frames.filter((frame) => frame.tick > tick));
    store.cache({ tick: 12, from: 'Ania', bytes: BLOB });
    expect(store.framesAfter(11)).toBeNull();
    expect(store.framesAfter(12)).toEqual(frames.slice(2));
    store.finishAt(14);
    expect(store.framesAfter(13)).toEqual([{ tick: 14, commands: [] }]);
    expect(store.framesAfter(14)).toEqual([]);
  });

  it('preserves admitted army gestures and the room when recovery history fills, then admits after refresh', () => {
    const s = stage();
    const peers = Array.from({ length: 12 }, (_, player) =>
      s.introduce(`history-player-${player}-0123456789`, `Player${player}`),
    );
    const host = peers[0];
    if (host === undefined) throw new Error('missing host');
    host.send({
      kind: 'createRoom',
      settings: SETTINGS,
      seats: peers.map((_, player) => ({ player, color: player, mode: 'idle', offers: ['idle', 'ai'] })),
    });
    const roomId = host.last('room')?.room.id;
    for (const [player, peer] of peers.entries()) {
      if (peer !== host) peer.send({ kind: 'joinRoom', roomId });
      peer.send({ kind: 'claimSeat', player });
    }
    for (const peer of peers) peer.send({ kind: 'setReady', ready: true });
    host.send({ kind: 'start' });
    for (const peer of peers) peer.send({ kind: 'loaded', tick: 0, world: 0 });
    const envelope = {
      v: 1,
      origin: 'player',
      player: 0,
      command: {
        kind: 'moveUnitGroup',
        members: Array.from({ length: 4096 }, (_, index) => ({ entity: index + 1, x: 100, y: 100 })),
      },
    };
    expect(() => parseCommandEnvelope(envelope)).not.toThrow();
    for (const peer of peers)
      for (let command = 0; command < 8; command++) peer.send({ kind: 'command', envelope, fromTick: 0 });
    expect(peers.flatMap((peer) => peer.of('rejected'))).toEqual([]);
    s.advance(TICK_MS * 2);
    const admitted = host.last('frame');
    expect(admitted?.tick).toBe(2);
    expect(admitted?.commands).toHaveLength(96);
    expect(admitted?.commands.map(({ sequence }) => sequence)).toEqual(
      Array.from({ length: 96 }, (_, index) => index),
    );
    for (const command of admitted?.commands ?? [])
      expect(command.envelope.command).toEqual(envelope.command);
    for (const peer of peers) {
      ackThrough(peer, 1, 2);
      peer.send({ kind: 'command', envelope, fromTick: 2 });
      expect(peer.last('rejected')?.reason).toEqual({ code: 'commandBudget' });
    }
    s.advance(TICK_MS * 2);
    expect(host.of('snapshotRequest')).toHaveLength(1);
    expect(host.last('frame')).toMatchObject({ tick: 4, commands: [] });
    expect(peers.flatMap((peer) => peer.of('error'))).toEqual([]);
    expect(s.relay.roomCount).toBe(1);
    for (const peer of peers) ackThrough(peer, 3, 4);
    snapshot(host);
    const refused = host.of('rejected').length;
    host.send({ kind: 'command', envelope, fromTick: 4 });
    expect(host.of('rejected')).toHaveLength(refused);
    s.advance(TICK_MS * 2);
    expect(host.last('frame')).toMatchObject({ tick: 6, commands: [{ envelope }] });
    expect(peers.flatMap((peer) => peer.of('error'))).toEqual([]);
    expect(s.relay.roomCount).toBe(1);
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
    expect(s.a.last('error')?.reason).toEqual({ code: 'historyAge' });
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
