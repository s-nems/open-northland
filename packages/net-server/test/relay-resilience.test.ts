import { type ClientLoad, MAX_CLIENT_MESSAGE_BYTES, TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import {
  INITIAL_INPUT_DELAY_TICKS,
  KICK_COUNTDOWN_MS,
  SILENT_AFTER_MS,
  SNAPSHOT_REFRESH_MS,
  SNAPSHOT_RETRY_MS,
} from '../src/index.js';
import {
  CATCH_UP_SHARE,
  framesIn,
  GOVERN_RELEASE_MS,
  LAG_BEHIND_MS,
  MIN_GOVERNED_SPEED,
  SLOW_AT_ONCE_MS,
  SLOW_GRACE_MS,
} from '../src/relay/governor.js';
import {
  ackThrough,
  digest,
  LOAD,
  type MessageStage,
  type Peer,
  roomOfThree,
  SEATS,
  SETTINGS,
  seatCommand,
  stage,
  startedRoom,
  TOKEN_A,
  TOKEN_B,
  TOKEN_C,
} from './support/message-stage.js';

/**
 * The relay's resilience, message by message: when the clock waits and for whom, how a vote passes,
 * what a diverged digest sets off, and how a client is brought back to the present.
 */

const BLOB = Buffer.from('bytes the relay never reads').toString('base64');
const LAG_TICKS = framesIn(LAG_BEHIND_MS, SETTINGS.speed);
/** Wall time a member trailing from the first frame takes to pass the lag threshold. */
const LAG_ONSET_MS = (LAG_TICKS + 1) * TICK_MS;
/** Long enough, by a margin of a few ticks, for a member trailing from the first frame to be slow. */
const SLOW_AFTER_MS = LAG_ONSET_MS + SLOW_GRACE_MS + TICK_MS * 4;
/** A member this far behind is lagging, under twice the threshold. */
const LAGGING_MS = 1500;
/** Lagging this long is still within the grace. */
const SHORT_OF_GRACE_MS = 3000;
const RELEASE_TICKS = framesIn(GOVERN_RELEASE_MS, SETTINGS.speed);
/** A client whose sim tick costs two ticks of wall time: it sustains half the speed. */
const SLOW_LOAD: ClientLoad = { tickMs: TICK_MS * 2, buffered: 0 };
const SLOW_GOVERNED_SPEED = 0.4;
/** Wall time a silent member stays unheard: past `SILENT_AFTER_MS`, so the clock holds for it. */
const SILENT_SPELL_MS = 5000;
/** A requested speed above 1, so frames of lag differ from wall time. */
const FAST_SPEED = 3;
/** Wall time both members keep up at `FAST_SPEED` before one falls away. */
const KEPT_UP_MS = 8000;
/** A lag past `SLOW_AT_ONCE_MS`, in wall time of frames. */
const FAR_BEHIND_MS = 6000;
/** Wall time over which the frame rate is counted. */
const RATE_WINDOW_MS = 3000;
/** Wall time a dropped member stays away, far past the grace. */
const LONG_ABSENCE_MS = 60_000;
/** Wall time a member has lagged when it drops, well within the grace. */
const LAGGED_BEFORE_DROP_MS = 1000;
/** A lag past `LAG_BEHIND_MS` and short of `SLOW_AT_ONCE_MS`, in wall time of frames. */
const RETURN_BEHIND_MS = 3000;
/** Wall time the clock runs at `SLOW_GOVERNED_SPEED` past a snapshot: frames past the release
 *  threshold and short of the lag one. */
const PAST_SNAPSHOT_MS = 2000;
/** Ticks of margin around a grace boundary, for the advance a hold or a return lands on. */
const BOUNDARY_TICKS = 4;
const answeredPing = new WeakMap<Peer, number>();
const ackedTick = new WeakMap<Peer, number>();

function lastTick(peer: Peer): number {
  return peer.last('frame')?.tick ?? 0;
}

/** Move the clock, answering every ping so the peers stay heard. */
function tick(s: MessageStage, peers: readonly Peer[], ms: number): void {
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
    s.advance(TICK_MS);
    for (const peer of peers) {
      const ping = peer.last('ping');
      if (ping === undefined || answeredPing.get(peer) === ping.t) continue;
      answeredPing.set(peer, ping.t);
      peer.send({ kind: 'pong', t: ping.t });
    }
  }
}

/** Move the clock with `peers` acknowledging each frame as it arrives, and `heard` answering pings. */
function play(s: MessageStage, peers: readonly Peer[], ms: number, heard: readonly Peer[] = peers): void {
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
    tick(s, heard, TICK_MS);
    for (const peer of peers) {
      const acked = ackedTick.get(peer) ?? 0;
      const emitted = lastTick(peer);
      if (emitted > acked) ackThrough(peer, acked + 1, emitted);
      ackedTick.set(peer, emitted);
    }
  }
}

/** Acknowledge every tick through `tick` not yet acknowledged, reporting `load`. */
function ackTo(peer: Peer, tick: number, load: ClientLoad): void {
  const acked = ackedTick.get(peer) ?? 0;
  for (let t = acked + 1; t <= tick; t++)
    peer.send({ kind: 'ack', tick: t, digest: digest(1), world: 0, load });
  ackedTick.set(peer, Math.max(acked, tick));
}

/** Move the clock with `lead` acknowledging every frame and `trailer` staying `behind` ticks short. */
function trail(
  s: MessageStage,
  lead: Peer,
  trailer: Peer,
  behind: number,
  ms: number,
  load: ClientLoad,
): void {
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
    tick(s, [lead, trailer], TICK_MS);
    ackTo(lead, lastTick(lead), LOAD);
    ackTo(trailer, lastTick(trailer) - behind, load);
  }
}

/** Frames the clock emits over `ms` while `trailer` stays `behind`. */
function framesOver(s: MessageStage, lead: Peer, trailer: Peer, behind: number, ms: number): number {
  const before = lastTick(lead);
  trail(s, lead, trailer, behind, ms, SLOW_LOAD);
  return lastTick(lead) - before;
}

describe('waiting for a member', () => {
  it('holds the clock for a dropped connection and resumes when its token returns', () => {
    const s = startedRoom();
    s.advance(TICK_MS * 2);
    s.relay.disconnect(s.b.handle);
    s.advance(TICK_MS);
    expect(s.a.last('waiting')).toEqual({
      kind: 'waiting',
      for: [{ nick: 'Bartek', reason: 'gone', voteAfterMs: KICK_COUNTDOWN_MS }],
    });
    s.advance(TICK_MS * 10);
    expect(lastTick(s.a)).toBe(2);

    const back = s.introduce(TOKEN_B, 'Bartek');
    back.send({ kind: 'loaded', tick: 2, world: 0 });
    s.advance(TICK_MS);
    expect(s.a.last('waiting')?.for).toEqual([]);
    expect(lastTick(s.a)).toBe(3);
    expect(back.of('frame').map((frame) => frame.tick)).toEqual([3]);
  });

  it('treats a connection that answers no ping as silent', () => {
    const s = startedRoom();
    play(s, [s.a], SILENT_AFTER_MS + TICK_MS * 2);
    expect(s.a.last('waiting')?.for).toMatchObject([{ nick: 'Bartek', reason: 'silent' }]);
    expect(s.b.last('waiting')?.for).toMatchObject([{ nick: 'Bartek', reason: 'silent' }]);
  });

  it('counts frames on from the tick the built worlds stand at, and holds every world to it', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    b.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id ?? '' });
    a.send({ kind: 'claimSeat', player: 0 });
    b.send({ kind: 'claimSeat', player: 1 });
    a.send({ kind: 'setReady', ready: true });
    b.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    a.send({ kind: 'loaded', tick: 1, world: 0 });
    b.send({ kind: 'loaded', tick: 3, world: 0 });
    expect(b.last('rejected')?.reason).toEqual({ code: 'worldTickMismatch', tick: 1 });
    b.send({ kind: 'loaded', tick: 1, world: 0 });
    expect(a.last('clock')).toMatchObject({ tick: 2 });
    s.advance(TICK_MS);
    expect(a.of('frame').map((frame) => frame.tick)).toEqual([2]);
    a.send({ kind: 'ack', load: LOAD, tick: 2, digest: digest(1), world: 0 });
    expect(a.of('rejected')).toEqual([]);
  });

  it('waits for a member that never loads, before the start, until it is voted out', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    b.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id ?? '' });
    a.send({ kind: 'claimSeat', player: 0 });
    b.send({ kind: 'claimSeat', player: 2 });
    a.send({ kind: 'setReady', ready: true });
    b.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    a.send({ kind: 'loaded', tick: 1, world: 0 });
    tick(s, [a, b], KICK_COUNTDOWN_MS + TICK_MS);
    expect(a.of('clock')).toEqual([]);
    expect(a.last('waiting')?.for).toEqual([{ nick: 'Bartek', reason: 'loading', voteAfterMs: 0 }]);
    a.send({ kind: 'kick', player: 2, yes: true });
    expect(a.last('kicked')).toMatchObject({ nick: 'Bartek', mode: 'ai', tick: 2 });
    expect(a.last('clock')).toMatchObject({ tick: 2 });
    tick(s, [a], TICK_MS * 2);
    expect(a.of('frame')[0]?.commands[0]?.envelope).toMatchObject({ origin: 'admin' });
  });

  it('never starts a clock nobody has loaded into', () => {
    const t = stage();
    const a = t.introduce(TOKEN_A, 'Ania');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    a.send({ kind: 'claimSeat', player: 0 });
    a.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    t.relay.disconnect(a.handle);
    t.advance(TICK_MS * 3);
    const back = t.introduce(TOKEN_A, 'Ania');
    expect(back.of('clock')).toEqual([]);
    back.send({ kind: 'loaded', tick: 1, world: 0 });
    expect(back.of('rejected')).toEqual([]);
    expect(back.last('clock')).toMatchObject({ tick: 2 });
  });

  it('refuses a world claiming to stand ahead of the clock', () => {
    const s = startedRoom();
    s.advance(TICK_MS * 3);
    s.relay.disconnect(s.b.handle);
    const back = s.introduce(TOKEN_B, 'Bartek');
    back.send({ kind: 'loaded', tick: 9, world: 0 });
    expect(back.last('rejected')?.reason).toEqual({ code: 'tickNotEmitted', tick: 9 });
    back.send({ kind: 'loaded', tick: 3, world: 0 });
    expect(back.of('rejected')).toHaveLength(1);
  });

  it('holds the start for a member that dropped before loading, and counts one down per member', () => {
    // Cezary never loads: its socket drops first.
    const t = stage();
    const a = t.introduce(TOKEN_A, 'Ania');
    const b = t.introduce(TOKEN_B, 'Bartek');
    const c = t.introduce(TOKEN_C, 'Cezary');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    const roomId = a.last('room')?.room.id ?? '';
    b.send({ kind: 'joinRoom', roomId });
    c.send({ kind: 'joinRoom', roomId });
    a.send({ kind: 'claimSeat', player: 0 });
    b.send({ kind: 'claimSeat', player: 1 });
    c.send({ kind: 'claimSeat', player: 2 });
    for (const peer of [a, b, c]) peer.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    a.send({ kind: 'loaded', tick: 0, world: 0 });
    b.send({ kind: 'loaded', tick: 0, world: 0 });
    expect(a.of('clock')).toEqual([]);
    t.relay.disconnect(c.handle);
    expect(a.of('clock')).toEqual([]);
    tick(t, [a, b], TICK_MS * 2);
    expect(a.last('waiting')?.for).toMatchObject([
      { nick: 'Cezary', reason: 'gone', voteAfterMs: KICK_COUNTDOWN_MS },
    ]);
    tick(t, [a, b], KICK_COUNTDOWN_MS / 2);
    t.relay.disconnect(b.handle);
    tick(t, [a], KICK_COUNTDOWN_MS / 2 + TICK_MS);
    const waited = a.last('waiting')?.for ?? [];
    expect(waited.find((entry) => entry.nick === 'Cezary')).toEqual({
      nick: 'Cezary',
      reason: 'gone',
      voteAfterMs: 0,
    });
    const bartek = waited.find((entry) => entry.nick === 'Bartek');
    expect(bartek?.voteAfterMs).toBeGreaterThan(KICK_COUNTDOWN_MS / 3);
    expect(Number.isInteger(bartek?.voteAfterMs)).toBe(true);
    a.send({ kind: 'kick', player: 1, yes: true });
    expect(a.last('rejected')?.reason).toMatchObject({ code: 'voteNotOpen' });
    a.send({ kind: 'kick', player: 2, yes: true });
    expect(a.last('kicked')?.nick).toBe('Cezary');
    // Bartek loaded but dropped before the start, so the game still waits for him.
    expect(a.of('clock')).toEqual([]);
  });

  it('refuses an acknowledgement out of order or ahead of the clock', () => {
    const s = startedRoom();
    s.advance(TICK_MS * 3);
    s.a.send({ kind: 'ack', load: LOAD, tick: 2, digest: digest(1), world: 0 });
    expect(s.a.last('rejected')?.reason).toEqual({ code: 'ackOutOfOrder', expected: 1 });
    s.a.send({ kind: 'ack', load: LOAD, tick: 1, digest: digest(1), world: 0 });
    s.a.send({ kind: 'ack', load: LOAD, tick: 2, digest: digest(1), world: 0 });
    s.a.send({ kind: 'ack', load: LOAD, tick: 3, digest: digest(1), world: 0 });
    s.a.send({ kind: 'ack', load: LOAD, tick: 4, digest: digest(1), world: 0 });
    expect(s.a.last('rejected')?.reason).toMatchObject({ code: 'tickNotEmitted' });
  });
});

describe('pacing the clock for a slow member', () => {
  it('neither waits for nor paces for a member at the lag threshold', () => {
    const s = startedRoom();
    trail(s, s.a, s.b, LAG_TICKS, SLOW_GRACE_MS * 2, SLOW_LOAD);
    expect(s.a.last('waiting')?.for).toEqual([]);
    expect(s.a.last('clock')?.governed).toBeNull();
  });

  it('lets a lagging member catch up alone through the grace, then paces the clock for it unwaited', () => {
    const s = startedRoom();
    const behind = framesIn(LAGGING_MS, SETTINGS.speed);
    trail(s, s.a, s.b, behind, LAG_ONSET_MS, SLOW_LOAD);
    trail(s, s.a, s.b, behind, SHORT_OF_GRACE_MS, SLOW_LOAD);
    expect(s.a.last('waiting')?.for).toEqual([]);
    expect(s.a.last('clock')?.governed).toBeNull();
    trail(s, s.a, s.b, behind, SLOW_GRACE_MS - SHORT_OF_GRACE_MS + TICK_MS * 2, SLOW_LOAD);
    expect(s.a.last('clock')?.governed).toEqual({
      nick: 'Bartek',
      speed: SLOW_GOVERNED_SPEED,
      cause: 'load',
    });
    expect(s.a.last('waiting')?.for).toEqual([]);
  });

  it('paces the clock at a slow member’s sustainable speed without holding it, and releases it lower', () => {
    const s = startedRoom();
    trail(s, s.a, s.b, LAG_TICKS + 1, SLOW_AFTER_MS, SLOW_LOAD);
    expect(s.a.last('waiting')?.for).toEqual([]);
    const governed = { nick: 'Bartek', speed: SLOW_GOVERNED_SPEED, cause: 'load' };
    expect(s.b.last('clock')).toMatchObject({ speed: SETTINGS.speed, paused: false, by: null, governed });
    const governedFrames = framesIn(RATE_WINDOW_MS, SLOW_GOVERNED_SPEED);
    expect(framesOver(s, s.a, s.b, LAG_TICKS + 1, RATE_WINDOW_MS)).toBeGreaterThanOrEqual(governedFrames - 1);
    expect(framesOver(s, s.a, s.b, LAG_TICKS + 1, RATE_WINDOW_MS)).toBeLessThanOrEqual(governedFrames);

    // Between the two thresholds it stays slow; at the lower one it is released.
    trail(s, s.a, s.b, RELEASE_TICKS + 1, TICK_MS * 2, SLOW_LOAD);
    expect(s.a.last('clock')?.governed).toEqual(governed);
    trail(s, s.a, s.b, RELEASE_TICKS, TICK_MS * 2, SLOW_LOAD);
    expect(s.a.last('clock')).toMatchObject({ speed: SETTINGS.speed, governed: null });
    const fullFrames = framesIn(RATE_WINDOW_MS, SETTINGS.speed);
    expect(framesOver(s, s.a, s.b, RELEASE_TICKS, RATE_WINDOW_MS)).toBeGreaterThanOrEqual(fullFrames - 1);
  });

  it('paces a slow member whose load says it keeps up at the catch-up share, for its lag', () => {
    const s = startedRoom();
    trail(s, s.a, s.b, LAG_TICKS + 1, SLOW_AFTER_MS, LOAD);
    expect(s.a.last('clock')?.governed).toEqual({
      nick: 'Bartek',
      speed: SETTINGS.speed * CATCH_UP_SHARE,
      cause: 'lag',
    });
    expect(s.a.last('waiting')?.for).toEqual([]);
  });

  it('announces a requested speed with the governed speed recomputed for it, never lifting it', () => {
    const s = startedRoom();
    trail(s, s.a, s.b, LAG_TICKS + 1, SLOW_AFTER_MS, SLOW_LOAD);
    const governed = { nick: 'Bartek', speed: SLOW_GOVERNED_SPEED, cause: 'load' };
    expect(s.b.last('clock')?.governed).toEqual(governed);
    const aboveGoverned = SLOW_GOVERNED_SPEED * 2;
    s.a.send({ kind: 'clock', speed: aboveGoverned });
    expect(s.b.last('clock')).toMatchObject({ speed: aboveGoverned, by: 'Ania', governed });
    const belowFloor = MIN_GOVERNED_SPEED / 2;
    s.a.send({ kind: 'clock', speed: belowFloor });
    expect(s.b.last('clock')).toMatchObject({
      speed: belowFloor,
      by: 'Ania',
      governed: { nick: 'Bartek', speed: belowFloor, cause: 'lag' },
    });
  });

  it('keeps the clock running for a slow member that never acknowledges, with no wait and no vote', () => {
    const s = startedRoom();
    play(s, [s.a], SLOW_AFTER_MS + TICK_MS * 2, [s.a, s.b]);
    expect(s.a.last('waiting')?.for).toEqual([]);
    expect(s.a.last('clock')?.governed).toEqual({
      nick: 'Bartek',
      speed: SETTINGS.speed * CATCH_UP_SHARE,
      cause: 'lag',
    });
    const before = lastTick(s.a);
    play(s, [s.a], KICK_COUNTDOWN_MS, [s.a, s.b]);
    expect(lastTick(s.a)).toBeGreaterThan(before);
    expect(s.a.last('waiting')?.for).toEqual([]);
    s.a.send({ kind: 'kick', player: 1, yes: true });
    expect(s.a.last('rejected')?.reason).toEqual({ code: 'notWaitedFor', nick: 'Bartek' });
  });

  it('keeps a slow member slow through a hold for its silence, with no fresh grace on its answer', () => {
    const s = startedRoom();
    trail(s, s.a, s.b, framesIn(LAGGING_MS, SETTINGS.speed), SLOW_AFTER_MS, SLOW_LOAD);
    const governed = { nick: 'Bartek', speed: SLOW_GOVERNED_SPEED, cause: 'load' };
    expect(s.a.last('clock')?.governed).toEqual(governed);

    play(s, [s.a], SILENT_SPELL_MS, [s.a]);
    expect(s.a.last('waiting')?.for).toMatchObject([{ nick: 'Bartek', reason: 'silent' }]);
    const held = lastTick(s.a);
    play(s, [s.a], TICK_MS * 2, [s.a]);
    expect(lastTick(s.a)).toBe(held);
    // Still under `SLOW_AT_ONCE_MS` behind, so only the kept verdict can govern it on its answer.
    expect(held - (ackedTick.get(s.b) ?? 0)).toBeLessThanOrEqual(framesIn(SLOW_AT_ONCE_MS, SETTINGS.speed));

    // Its pong lands after one advance; the next one hears it and lets the clock go on.
    tick(s, [s.a, s.b], TICK_MS * 2);
    expect(s.a.last('waiting')?.for).toEqual([]);
    expect(s.a.last('clock')?.governed).toEqual(governed);
    tick(s, [s.a, s.b], RATE_WINDOW_MS);
    expect(lastTick(s.a)).toBeGreaterThan(held);
    expect(s.a.last('clock')?.governed).toEqual(governed);
  });

  it('keeps a slow member slow through a hold for its dropped connection', () => {
    const s = startedRoom();
    const behind = framesIn(LAGGING_MS, SETTINGS.speed);
    trail(s, s.a, s.b, behind, SLOW_AFTER_MS, SLOW_LOAD);
    const governed = { nick: 'Bartek', speed: SLOW_GOVERNED_SPEED, cause: 'load' };
    expect(s.a.last('clock')?.governed).toEqual(governed);

    s.relay.disconnect(s.b.handle);
    tick(s, [s.a], LONG_ABSENCE_MS);
    expect(s.a.last('waiting')?.for).toMatchObject([{ nick: 'Bartek', reason: 'gone' }]);
    const back = s.introduce(TOKEN_B, 'Bartek');
    back.send({ kind: 'loaded', tick: ackedTick.get(s.b) ?? 0, world: 0 });
    ackedTick.set(back, ackedTick.get(s.b) ?? 0);
    trail(s, s.a, back, behind, TICK_MS * 2, SLOW_LOAD);
    expect(s.a.last('waiting')?.for).toEqual([]);
    expect(s.a.last('clock')?.governed).toEqual(governed);
  });

  it('keeps a slow member slow when its return asks for a snapshot the relay refuses', () => {
    const s = startedRoom();
    const behind = framesIn(LAGGING_MS, SETTINGS.speed);
    trail(s, s.a, s.b, behind, SLOW_AFTER_MS, SLOW_LOAD);
    const governed = { nick: 'Bartek', speed: SLOW_GOVERNED_SPEED, cause: 'load' };
    expect(s.a.last('clock')?.governed).toEqual(governed);

    s.relay.disconnect(s.b.handle);
    const back = s.introduce(TOKEN_B, 'Bartek');
    expect(back.last('start')?.snapshotTick).toBeNull();
    back.send({ kind: 'loaded', tick: null });
    expect(back.last('rejected')?.reason).toEqual({ code: 'noSnapshot' });
    back.send({ kind: 'loaded', tick: ackedTick.get(s.b) ?? 0, world: 0 });
    ackedTick.set(back, ackedTick.get(s.b) ?? 0);
    trail(s, s.a, back, behind, TICK_MS * 2, SLOW_LOAD);
    expect(s.a.last('clock')?.governed).toEqual(governed);
  });

  it('pauses a lagging member’s grace while the clock holds for it', () => {
    const s = startedRoom();
    const behind = framesIn(RETURN_BEHIND_MS, SETTINGS.speed);
    play(s, [s.a, s.b], KEPT_UP_MS);
    trail(s, s.a, s.b, behind, LAG_ONSET_MS + LAGGED_BEFORE_DROP_MS, SLOW_LOAD);
    expect(s.a.last('clock')?.governed).toBeNull();

    s.relay.disconnect(s.b.handle);
    tick(s, [s.a], LONG_ABSENCE_MS);
    const back = s.introduce(TOKEN_B, 'Bartek');
    const resumedAt = lastTick(s.a) - behind;
    back.send({ kind: 'loaded', tick: resumedAt, world: 0 });
    ackedTick.set(back, resumedAt);
    const graceLeftMs = SLOW_GRACE_MS - LAGGED_BEFORE_DROP_MS;
    trail(s, s.a, back, behind, graceLeftMs - TICK_MS * BOUNDARY_TICKS, SLOW_LOAD);
    expect(s.a.last('waiting')?.for).toEqual([]);
    expect(s.a.last('clock')?.governed).toBeNull();
    trail(s, s.a, back, behind, TICK_MS * BOUNDARY_TICKS * 2, SLOW_LOAD);
    expect(s.a.last('clock')?.governed).toMatchObject({ nick: 'Bartek' });
  });

  it('paces for nobody while a slow member that diverged rebuilds, nor after, until it lags again', () => {
    const s = startedRoom();
    const behind = framesIn(LAGGING_MS, SETTINGS.speed);
    trail(s, s.a, s.b, behind, SLOW_AFTER_MS, SLOW_LOAD);
    expect(s.a.last('clock')?.governed).toMatchObject({ nick: 'Bartek' });

    const diverged = (ackedTick.get(s.b) ?? 0) + 1;
    s.b.send({
      kind: 'ack',
      load: SLOW_LOAD,
      tick: diverged,
      digest: { ...digest(1), economy: 9 },
      world: 0,
    });
    expect(s.b.last('desync')?.tick).toBe(diverged);
    tick(s, [s.a, s.b], TICK_MS * 2);
    expect(s.a.last('waiting')?.for).toMatchObject([{ nick: 'Bartek', reason: 'resync' }]);
    expect(s.a.last('clock')?.governed).toBeNull();

    const snapshotTick = lastTick(s.a);
    s.a.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: snapshotTick, bytes: BLOB });
    expect(s.b.last('blob')?.tick).toBe(snapshotTick);
    ackedTick.set(s.b, snapshotTick);
    trail(s, s.a, s.b, behind, LAG_ONSET_MS + SHORT_OF_GRACE_MS, SLOW_LOAD);
    expect(s.a.last('waiting')?.for).toEqual([]);
    expect(s.a.last('clock')?.governed).toBeNull();
    trail(s, s.a, s.b, behind, SLOW_GRACE_MS - SHORT_OF_GRACE_MS + TICK_MS * BOUNDARY_TICKS, SLOW_LOAD);
    expect(s.a.last('clock')?.governed).toMatchObject({ nick: 'Bartek' });
  });

  it('paces for nobody after a slow member’s world is rebuilt from the snapshot, while it trails under the lag', () => {
    const s = startedRoom();
    const behind = framesIn(LAGGING_MS, SETTINGS.speed);
    trail(s, s.a, s.b, behind, SLOW_AFTER_MS, SLOW_LOAD);
    const snapshotTick = lastTick(s.a);
    s.a.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: snapshotTick, bytes: BLOB });
    trail(s, s.a, s.b, behind, PAST_SNAPSHOT_MS, SLOW_LOAD);
    expect(s.a.last('clock')?.governed).toMatchObject({ nick: 'Bartek' });
    // Past the release, so only a forgotten verdict lets it go; short of the lag, so it is not lagging.
    const rebuiltBehind = lastTick(s.a) - snapshotTick;
    expect(rebuiltBehind).toBeGreaterThan(RELEASE_TICKS);
    expect(rebuiltBehind).toBeLessThanOrEqual(LAG_TICKS);

    s.relay.disconnect(s.b.handle);
    const back = s.introduce(TOKEN_B, 'Bartek');
    back.send({ kind: 'loaded', tick: null });
    expect(back.last('blob')?.tick).toBe(snapshotTick);
    ackedTick.set(back, snapshotTick);
    tick(s, [s.a, back], TICK_MS);
    expect(s.a.last('waiting')?.for).toEqual([]);
    expect(s.a.last('clock')?.governed).toBeNull();
  });

  it('paces at once for a member trailing past the at-once lag, without the grace', () => {
    const s = startedRoom();
    s.a.send({ kind: 'clock', speed: FAST_SPEED });
    play(s, [s.a, s.b], KEPT_UP_MS);
    s.relay.disconnect(s.b.handle);
    const back = s.introduce(TOKEN_B, 'Bartek');
    back.send({ kind: 'loaded', tick: lastTick(s.a) - framesIn(FAR_BEHIND_MS, FAST_SPEED), world: 0 });
    tick(s, [s.a, back], TICK_MS);
    expect(s.a.last('waiting')?.for).toEqual([]);
    expect(s.a.last('clock')?.governed).toMatchObject({ nick: 'Bartek', cause: 'lag' });
  });

  it('holds the clock for a dropped member even while another is paced for', () => {
    const s = roomOfThree();
    trail(s, s.a, s.b, LAG_TICKS + 1, SLOW_AFTER_MS, SLOW_LOAD);
    s.relay.disconnect(s.c.handle);
    trail(s, s.a, s.b, LAG_TICKS + 1, TICK_MS, SLOW_LOAD);
    expect(s.a.last('waiting')?.for).toMatchObject([{ nick: 'Cezary', reason: 'gone' }]);
    expect(s.a.last('clock')?.governed).toMatchObject({ nick: 'Bartek' });
    const held = lastTick(s.a);
    trail(s, s.a, s.b, LAG_TICKS + 1, RATE_WINDOW_MS, SLOW_LOAD);
    expect(lastTick(s.a)).toBe(held);
  });

  it('holds a dropped member for everyone, unpaused or not, until the vote at its countdown’s end passes', () => {
    const s = roomOfThree();
    tick(s, [s.a, s.b, s.c], TICK_MS * 4);
    s.a.send({ kind: 'clock', paused: true });
    s.relay.disconnect(s.c.handle);
    const held = lastTick(s.a);
    tick(s, [s.a, s.b], TICK_MS);
    expect(s.a.last('waiting')?.for).toEqual([
      { nick: 'Cezary', reason: 'gone', voteAfterMs: KICK_COUNTDOWN_MS },
    ]);

    s.b.send({ kind: 'clock', paused: false });
    expect(s.a.last('clock')).toMatchObject({ paused: false, by: 'Bartek' });
    tick(s, [s.a, s.b], TICK_MS);
    expect(lastTick(s.a)).toBe(held);
    tick(s, [s.a, s.b], KICK_COUNTDOWN_MS);
    expect(lastTick(s.a)).toBe(held);
    expect(s.a.last('waiting')?.for).toEqual([{ nick: 'Cezary', reason: 'gone', voteAfterMs: 0 }]);

    s.a.send({ kind: 'kick', player: 2, yes: true });
    expect(s.b.last('kickVote')).toMatchObject({ nick: 'Cezary', yes: ['Ania'], needed: 2 });
    expect(s.b.of('kicked')).toEqual([]);
    s.b.send({ kind: 'kick', player: 2, yes: true });
    expect(s.b.last('kicked')).toMatchObject({ nick: 'Cezary', tick: held + 1 });
    tick(s, [s.a, s.b], TICK_MS);
    expect(lastTick(s.a)).toBeGreaterThan(held);
    expect(s.a.last('waiting')?.for).toEqual([]);
  });
});

describe('kick votes', () => {
  it('hands a voluntary departure to AI on the exact next tick without voting', () => {
    const s = roomOfThree('ai');
    s.advance(TICK_MS * 4);
    s.b.send({ kind: 'leaveRoom' });
    expect(s.a.last('kicked')).toMatchObject({ player: 1, mode: 'ai', cause: 'left', tick: 5 });
    expect(s.a.last('room')?.room.seats[1]).toMatchObject({ mode: 'ai', nick: null });
    tick(s, [s.a, s.c], TICK_MS);
    expect(s.a.of('frame').find((frame) => frame.tick === 5)?.commands).toMatchObject([
      { envelope: { origin: 'admin', command: { kind: 'setPlayerAi', player: 1, enabled: true } } },
    ]);
    expect(s.a.of('kickVote')).toEqual([]);
  });

  it('uses the chosen idle fallout instead of the occupied seat original AI mode', () => {
    const s = roomOfThree('idle');
    s.advance(TICK_MS * 4);
    s.relay.disconnect(s.c.handle);
    s.advance(TICK_MS);
    tick(s, [s.a, s.b], KICK_COUNTDOWN_MS + TICK_MS);
    s.a.send({ kind: 'kick', player: 2, yes: true });
    s.b.send({ kind: 'kick', player: 2, yes: true });
    expect(s.a.last('kicked')).toMatchObject({ player: 2, mode: 'idle' });
    expect(s.a.last('room')?.room.seats[2]).toMatchObject({ mode: 'idle', nick: null });
    tick(s, [s.a, s.b], TICK_MS * 2);
    expect(s.a.of('frame').flatMap((frame) => frame.commands)).toEqual([]);
  });

  it('opens after the countdown, passes at a majority of everyone else, and hands the seat to the AI', () => {
    const s = roomOfThree();
    s.advance(TICK_MS * 4);
    s.relay.disconnect(s.c.handle);
    s.advance(TICK_MS);
    s.a.send({ kind: 'kick', player: 2, yes: true });
    expect(s.a.last('rejected')?.reason).toEqual({ code: 'voteNotOpen', seconds: 60 });
    tick(s, [s.a, s.b], KICK_COUNTDOWN_MS + TICK_MS);
    expect(s.a.last('waiting')).toEqual({
      kind: 'waiting',
      for: [{ nick: 'Cezary', reason: 'gone', voteAfterMs: 0 }],
    });
    s.a.send({ kind: 'kick', player: 2, yes: true });
    expect(s.b.last('kickVote')).toEqual({
      kind: 'kickVote',
      player: 2,
      nick: 'Cezary',
      yes: ['Ania'],
      needed: 2,
    });
    expect(s.b.of('kicked')).toEqual([]);
    s.b.send({ kind: 'kick', player: 2, yes: true });
    expect(s.b.last('kicked')).toEqual({
      kind: 'kicked',
      player: 2,
      nick: 'Cezary',
      mode: 'ai',
      cause: 'vote',
      tick: 5,
    });
    expect(s.b.last('room')?.room.seats[2]).toMatchObject({ mode: 'ai', nick: null });
    expect(s.b.last('room')?.room.members.map((member) => member.nick)).toEqual(['Ania', 'Bartek']);
    tick(s, [s.a, s.b], TICK_MS * 2);
    expect(s.a.last('waiting')?.for).toEqual([]);
    expect(s.a.of('frame').find((frame) => frame.tick === 5)?.commands).toEqual([
      {
        envelope: { v: 1, origin: 'admin', command: { kind: 'setPlayerAi', player: 2, enabled: true } },
        sequence: 0,
      },
    ]);
    // The kicked token is a stranger now: it comes back to no room.
    const stranger = s.introduce(TOKEN_C, 'Cezary');
    expect(stranger.of('room')).toEqual([]);
    expect(stranger.of('start')).toEqual([]);
  });

  it('needs a second yes among three voters, refuses a vote for someone not waited for, and leaves an idle seat quiet', () => {
    const s = stage();
    const peers = [TOKEN_A, TOKEN_B, TOKEN_C, 'token-d-0123456789ab'].map((token, i) =>
      s.introduce(token, ['Ania', 'Bartek', 'Cezary', 'Dorota'][i] ?? ''),
    );
    const [a, b, c, d] = peers;
    if (a === undefined || b === undefined || c === undefined || d === undefined) throw new Error('peers');
    a.send({
      kind: 'createRoom',
      settings: SETTINGS,
      seats: [0, 1, 2, 3].map((player) => ({
        player,
        mode: 'idle',
        offers: ['idle', 'ai', 'absent'],
        color: player,
      })),
    });
    const roomId = a.last('room')?.room.id ?? '';
    for (const peer of [b, c, d]) peer.send({ kind: 'joinRoom', roomId });
    peers.forEach((peer, i) => {
      peer.send({ kind: 'claimSeat', player: i });
    });
    for (const peer of peers) peer.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    for (const peer of peers) peer.send({ kind: 'loaded', tick: 0, world: 0 });
    s.advance(TICK_MS * 2);
    b.send({ kind: 'kick', player: 3, yes: true });
    expect(b.last('rejected')?.reason).toMatchObject({ code: 'notWaitedFor' });
    s.relay.disconnect(d.handle);
    tick(s, [a, b, c], KICK_COUNTDOWN_MS + TICK_MS);
    a.send({ kind: 'kick', player: 3, yes: true });
    a.send({ kind: 'kick', player: 3, yes: true });
    expect(c.last('kickVote')).toEqual({
      kind: 'kickVote',
      player: 3,
      nick: 'Dorota',
      yes: ['Ania'],
      needed: 2,
    });
    expect(c.of('kicked')).toEqual([]);
    b.send({ kind: 'kick', player: 3, yes: true });
    expect(c.last('kicked')).toMatchObject({ player: 3, nick: 'Dorota', mode: 'idle' });
    tick(s, [a, b, c], TICK_MS * 2);
    expect(a.of('frame').flatMap((frame) => frame.commands)).toEqual([]);
  });
});

describe('digests and resync', () => {
  it('names the minority by domain, asks the reference for a snapshot, and serves it with the frames since', () => {
    const s = startedRoom();
    s.advance(TICK_MS * 3);
    ackThrough(s.a, 1, 3, 1);
    ackThrough(s.b, 1, 2, 1);
    expect(s.b.of('desync')).toEqual([]);
    expect(s.a.of('disputed')).toEqual([]);
    s.b.send({ kind: 'ack', load: LOAD, tick: 3, digest: { ...digest(1), economy: 9 }, world: 0 });
    expect(s.b.last('desync')).toEqual({ kind: 'desync', tick: 3, domains: ['economy'], reference: 'Ania' });
    expect(s.a.of('desync')).toEqual([]);
    expect(s.a.of('disputed')).toEqual([
      { kind: 'disputed', tick: 3, domains: ['economy'], diverged: ['Bartek'] },
    ]);
    expect(s.b.of('disputed')).toEqual([]);
    expect(s.a.of('snapshotRequest')).toHaveLength(1);
    s.advance(TICK_MS * 2);
    expect(s.a.last('waiting')?.for).toMatchObject([{ nick: 'Bartek', reason: 'resync' }]);
    expect(lastTick(s.a)).toBe(3);

    s.b.send({ kind: 'ack', load: LOAD, tick: 4, digest: digest(1), world: 0 });
    expect(s.b.of('rejected')).toEqual([]);
    s.a.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: 2, bytes: BLOB });
    expect(s.b.last('blob')).toEqual({ kind: 'blob', type: 'snapshot', from: 'Ania', tick: 2, bytes: BLOB });
    expect(
      s.b
        .of('frame')
        .filter((frame) => frame.tick > 2)
        .map((frame) => frame.tick),
    ).toEqual([3, 3]);
    s.b.send({ kind: 'ack', load: LOAD, tick: 3, digest: digest(1), world: 0 });
    expect(s.b.of('rejected')).toEqual([]);
    s.advance(TICK_MS);
    expect(s.a.last('waiting')?.for).toEqual([]);
    expect(lastTick(s.a)).toBe(4);
  });

  it('drops a client’s held reports when it leaves, so its return is judged on the world it holds', () => {
    const s = roomOfThree();
    s.advance(TICK_MS * 4);
    ackThrough(s.a, 1, 2);
    ackThrough(s.b, 1, 3);
    s.b.send({ kind: 'ack', load: LOAD, tick: 4, digest: digest(9), world: 0 });
    s.relay.disconnect(s.b.handle);
    s.a.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: 2, bytes: BLOB });
    const back = s.introduce(TOKEN_B, 'Bartek');
    back.send({ kind: 'loaded', tick: 1, world: 0 });
    expect(back.of('blob').map((blob) => blob.tick)).toEqual([2]);
    ackThrough(back, 3, 4, 1, 2);
    ackThrough(s.a, 3, 4);
    ackThrough(s.c, 1, 4);
    expect(back.of('desync')).toEqual([]);
    expect(s.a.of('desync')).toEqual([]);
    expect(s.c.of('desync')).toEqual([]);
    for (const client of [back, s.a, s.c]) expect(client.of('disputed')).toEqual([]);
  });

  it('reports a world once per connection, and refuses a command before any world has loaded', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    b.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id });
    a.send({ kind: 'claimSeat', player: 0 });
    b.send({ kind: 'claimSeat', player: 1 });
    for (const peer of [a, b]) peer.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    a.send(seatCommand(0));
    expect(a.last('rejected')?.reason).toEqual({ code: 'noWorldYet' });
    a.send({ kind: 'loaded', tick: 0, world: 0 });
    a.send({ kind: 'loaded', tick: 0, world: 0 });
    expect(a.last('rejected')?.reason).toEqual({ code: 'alreadyLoaded' });
    b.send({ kind: 'loaded', tick: 0, world: 0 });
    a.send(seatCommand(0));
    expect(a.of('rejected')).toHaveLength(2);
    s.advance(TICK_MS * INITIAL_INPUT_DELAY_TICKS);
    expect(a.of('frame').flatMap((frame) => frame.commands)).toHaveLength(1);
  });

  it('asks the next donor as soon as the asked one drops, and one request serves everyone queued', () => {
    const s = roomOfThree();
    s.advance(TICK_MS * 2);
    ackThrough(s.a, 1, 2);
    ackThrough(s.c, 1, 2);
    s.b.send({ kind: 'ack', load: LOAD, tick: 1, digest: digest(9), world: 0 });
    expect(s.b.last('desync')?.tick).toBe(1);
    const asked = s.a.of('snapshotRequest').length === 1 ? s.a : s.c;
    const other = asked === s.a ? s.c : s.a;
    expect(other.of('snapshotRequest')).toEqual([]);
    s.relay.disconnect(asked.handle);
    s.advance(1);
    expect(other.of('snapshotRequest')).toHaveLength(1);
  });

  it('judges a tick among the clients in sync alone, without a dropped client’s report', () => {
    const s = roomOfThree();
    s.advance(TICK_MS * 2);
    s.a.send({ kind: 'ack', load: LOAD, tick: 1, digest: digest(9), world: 0 });
    s.c.send({ kind: 'ack', load: LOAD, tick: 1, digest: digest(1), world: 0 });
    s.c.send({ kind: 'ack', load: LOAD, tick: 2, digest: digest(1), world: 0 });
    s.relay.disconnect(s.a.handle);
    ackThrough(s.b, 1, 2);
    expect(s.b.of('desync')).toEqual([]);
    expect(s.c.of('desync')).toEqual([]);
    // Ania comes back where she stood and is judged against the tick her absence settled.
    const back = s.introduce(TOKEN_A, 'Ania');
    back.send({ kind: 'loaded', tick: 1, world: 0 });
    back.send({ kind: 'ack', load: LOAD, tick: 2, digest: digest(9), world: 0 });
    expect(back.last('desync')).toMatchObject({ tick: 2, reference: 'Bartek' });
  });

  it('settles a tick a returning client was moved past, so the others are still checked on it', () => {
    const s = roomOfThree();
    s.advance(TICK_MS * 4);
    ackThrough(s.a, 1, 4);
    s.relay.disconnect(s.c.handle);
    const back = s.introduce(TOKEN_C, 'Cezary');
    back.send({ kind: 'loaded', tick: 4, world: 0 });
    s.b.send({ kind: 'ack', load: LOAD, tick: 1, digest: digest(1), world: 0 });
    s.b.send({ kind: 'ack', load: LOAD, tick: 2, digest: digest(1), world: 0 });
    s.b.send({ kind: 'ack', load: LOAD, tick: 3, digest: digest(1), world: 0 });
    s.b.send({ kind: 'ack', load: LOAD, tick: 4, digest: { ...digest(1), economy: 5 }, world: 0 });
    expect(s.b.last('desync')).toMatchObject({ tick: 4, domains: ['economy'], reference: 'Ania' });
  });

  it('tells a diverged client that dropped of it again on return, and serves the snapshot it asks for', () => {
    const s = startedRoom();
    s.advance(TICK_MS);
    s.b.send({ kind: 'ack', load: LOAD, tick: 1, digest: digest(2), world: 0 });
    s.a.send({ kind: 'ack', load: LOAD, tick: 1, digest: digest(1), world: 0 });
    expect(s.b.of('desync')).toHaveLength(1);
    s.relay.disconnect(s.b.handle);
    s.a.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: 1, bytes: BLOB });
    const back = s.introduce(TOKEN_B, 'Bartek');
    expect(back.of('desync')).toHaveLength(1);
    expect(back.last('start')?.snapshotTick).toBe(1);
    back.send({ kind: 'loaded', tick: 1, world: 0 });
    expect(back.last('rejected')?.reason).toEqual({ code: 'worldOutOfSync' });
    back.send({ kind: 'loaded', tick: null });
    expect(back.of('blob').map((blob) => blob.tick)).toEqual([1]);
    s.advance(TICK_MS);
    expect(back.of('frame').map((frame) => frame.tick)).toEqual([2]);
    back.send({ kind: 'ack', load: LOAD, tick: 2, digest: digest(1), world: 1 });
    expect(back.of('rejected')).toHaveLength(1);
  });

  it('serves a returning diverged client the snapshot once, when it asks, not before', () => {
    const s = startedRoom();
    s.advance(TICK_MS);
    s.b.send({ kind: 'ack', load: LOAD, tick: 1, digest: digest(2), world: 0 });
    s.a.send({ kind: 'ack', load: LOAD, tick: 1, digest: digest(1), world: 0 });
    s.relay.disconnect(s.b.handle);
    const back = s.introduce(TOKEN_B, 'Bartek');
    expect(back.last('start')?.snapshotTick).toBeNull();
    // The requested snapshot lands while the returning client's own request is still on its way.
    s.a.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: 1, bytes: BLOB });
    expect(back.of('blob')).toEqual([]);
    back.send({ kind: 'loaded', tick: null });
    expect(back.of('rejected')).toEqual([]);
    expect(back.of('blob').map((blob) => blob.tick)).toEqual([1]);
  });

  it('serves a diverged client whose connection was replaced only when the new one asks', () => {
    const s = startedRoom();
    s.advance(TICK_MS);
    s.b.send({ kind: 'ack', load: LOAD, tick: 1, digest: digest(2), world: 0 });
    s.a.send({ kind: 'ack', load: LOAD, tick: 1, digest: digest(1), world: 0 });
    const back = s.introduce(TOKEN_B, 'Bartek');
    expect(back.of('desync')).toHaveLength(1);
    s.a.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: 1, bytes: BLOB });
    expect(back.of('blob')).toEqual([]);
    back.send({ kind: 'loaded', tick: null });
    expect(back.of('rejected')).toEqual([]);
    expect(back.of('blob').map((blob) => blob.tick)).toEqual([1]);
  });

  it('queues a returning diverged client that asks before any snapshot is cached', () => {
    const s = startedRoom();
    s.advance(TICK_MS);
    s.b.send({ kind: 'ack', load: LOAD, tick: 1, digest: digest(2), world: 0 });
    s.a.send({ kind: 'ack', load: LOAD, tick: 1, digest: digest(1), world: 0 });
    s.relay.disconnect(s.b.handle);
    const back = s.introduce(TOKEN_B, 'Bartek');
    back.send({ kind: 'loaded', tick: null });
    expect(back.of('rejected')).toEqual([]);
    s.a.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: 1, bytes: BLOB });
    expect(back.of('blob').map((blob) => blob.tick)).toEqual([1]);
  });

  it('asks the next donor as soon as the asked one is replaced by a newer connection', () => {
    const s = roomOfThree();
    s.advance(TICK_MS * 2);
    ackThrough(s.a, 1, 2);
    ackThrough(s.c, 1, 2);
    s.b.send({ kind: 'ack', load: LOAD, tick: 1, digest: digest(9), world: 0 });
    const asked = s.a.of('snapshotRequest').length === 1 ? s.a : s.c;
    const other = asked === s.a ? s.c : s.a;
    s.introduce(asked === s.a ? TOKEN_A : TOKEN_C, 'again');
    s.advance(1);
    expect(other.of('snapshotRequest')).toHaveLength(1);
  });

  it('asks for a snapshot again only while someone connected waits for it', () => {
    const s = startedRoom();
    s.advance(TICK_MS);
    s.b.send({ kind: 'ack', load: LOAD, tick: 1, digest: digest(2), world: 0 });
    s.a.send({ kind: 'ack', load: LOAD, tick: 1, digest: digest(1), world: 0 });
    s.relay.disconnect(s.b.handle);
    s.a.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: 1, bytes: BLOB });
    tick(s, [s.a], SNAPSHOT_RETRY_MS * 3);
    expect(s.a.of('snapshotRequest')).toHaveLength(1);
  });

  it('gives a two-client tie to the longer-connected one', () => {
    const s = startedRoom();
    s.advance(TICK_MS);
    s.b.send({ kind: 'ack', load: LOAD, tick: 1, digest: digest(2), world: 0 });
    s.a.send({ kind: 'ack', load: LOAD, tick: 1, digest: digest(1), world: 0 });
    expect(s.b.last('desync')?.reference).toBe('Ania');
    expect(s.a.of('desync')).toEqual([]);
  });

  it('repeats an unanswered snapshot request to whoever is best connected', () => {
    const s = startedRoom();
    s.advance(TICK_MS);
    s.b.send({ kind: 'ack', load: LOAD, tick: 1, digest: digest(2), world: 0 });
    s.a.send({ kind: 'ack', load: LOAD, tick: 1, digest: digest(1), world: 0 });
    expect(s.a.of('snapshotRequest')).toHaveLength(1);
    tick(s, [s.a], SNAPSHOT_RETRY_MS + TICK_MS);
    expect(s.a.of('snapshotRequest')).toHaveLength(2);
  });

  it('refuses a snapshot from a client out of sync or from the future', () => {
    const s = startedRoom();
    s.advance(TICK_MS);
    s.a.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: 5, bytes: BLOB });
    expect(s.a.last('rejected')?.reason).toMatchObject({ code: 'tickNotEmitted' });
    s.b.send({ kind: 'ack', load: LOAD, tick: 1, digest: digest(2), world: 0 });
    s.a.send({ kind: 'ack', load: LOAD, tick: 1, digest: digest(1), world: 0 });
    s.b.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: 1, bytes: BLOB });
    expect(s.b.last('rejected')?.reason).toEqual({ code: 'snapshotUnsynced' });
  });
});

describe('catching up', () => {
  it('serves a returning client the frames after the tick it stands at', () => {
    const s = startedRoom();
    s.advance(TICK_MS * 4);
    s.relay.disconnect(s.b.handle);
    const back = s.introduce(TOKEN_B, 'Bartek');
    expect(back.last('start')?.snapshotTick).toBeNull();
    back.send({ kind: 'loaded', tick: null });
    expect(back.last('rejected')?.reason).toEqual({ code: 'noSnapshot' });
    back.send({ kind: 'loaded', tick: 1, world: 0 });
    expect(back.of('frame').map((frame) => frame.tick)).toEqual([2, 3, 4]);
  });

  it('forwards manual saves without contaminating the live resync snapshot', () => {
    const s = startedRoom();
    s.advance(TICK_MS * 4);
    ackThrough(s.a, 1, 4);
    ackThrough(s.b, 1, 4);
    s.a.send({ kind: 'blob', type: 'save', to: null, tick: 3, bytes: BLOB });
    expect(s.b.last('blob')).toEqual({ kind: 'blob', type: 'save', from: 'Ania', tick: 3, bytes: BLOB });
    expect(s.a.of('blob')).toEqual([]);
    s.relay.disconnect(s.b.handle);
    const first = s.introduce(TOKEN_B, 'Bartek');
    first.send({ kind: 'loaded', tick: null });
    expect(first.last('rejected')?.reason).toEqual({ code: 'noSnapshot' });
    s.a.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick: 3, bytes: BLOB });
    s.relay.disconnect(first.handle);
    const back = s.introduce(TOKEN_B, 'Bartek');
    expect(back.last('start')?.snapshotTick).toBe(3);
    back.send({ kind: 'loaded', tick: null });
    expect(back.of('blob').map((blob) => [blob.type, blob.tick])).toEqual([['snapshot', 3]]);
    expect(back.of('frame').map((frame) => frame.tick)).toEqual([4]);
    // A world from before the cache is served the snapshot too, since the frames before it are gone.
    s.relay.disconnect(back.handle);
    const again = s.introduce(TOKEN_B, 'Bartek');
    again.send({ kind: 'loaded', tick: 1, world: 0 });
    expect(again.of('blob').map((blob) => blob.tick)).toEqual([3]);
  });

  it('refreshes the cached snapshot on its cadence from the best-connected client', () => {
    const s = startedRoom();
    tick(s, [s.a, s.b], TICK_MS * 2);
    expect(s.a.of('snapshotRequest')).toEqual([]);
    play(s, [s.a, s.b], SNAPSHOT_REFRESH_MS + TICK_MS);
    expect(s.a.of('snapshotRequest').length + s.b.of('snapshotRequest').length).toBe(1);
  });

  it('relays a map to one member by nick, byte for byte, and refuses an unknown one', () => {
    const base = stage();
    const a = base.introduce(TOKEN_A, 'Ania');
    const b = base.introduce(TOKEN_B, 'Bartek');
    a.send({ kind: 'createRoom', settings: { ...SETTINGS, mapOrigin: 'user' }, seats: SEATS });
    b.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id });
    const s = { a, b };
    s.a.send({ kind: 'blob', type: 'map', to: 'Bartek', tick: null, bytes: BLOB });
    expect(s.b.last('blob')).toEqual({ kind: 'blob', type: 'map', from: 'Ania', tick: null, bytes: BLOB });
    s.a.send({ kind: 'blob', type: 'map', to: 'Zenon', tick: null, bytes: BLOB });
    expect(s.a.last('rejected')?.reason).toEqual({ code: 'noRecipient', nick: 'Zenon' });
  });

  it('caps every message but a blob at the client message size', () => {
    const s = startedRoom();
    s.a.send(
      { kind: 'blob', type: 'map', to: 'Bartek', tick: null, bytes: BLOB },
      MAX_CLIENT_MESSAGE_BYTES + 1,
    );
    expect(s.a.of('error')).toEqual([]);
    s.a.send({ kind: 'chat', text: 'hej' }, MAX_CLIENT_MESSAGE_BYTES + 1);
    expect(s.a.last('error')?.reason).toEqual({ code: 'messageTooLarge' });
    expect(s.a.closed()).toBe('messageTooLarge');
  });
});

describe('a room that never started', () => {
  it('waits for nobody', () => {
    const s = stage();
    const a = s.introduce(TOKEN_A, 'Ania');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    a.send({ kind: 'claimSeat', player: 0 });
    tick(s, [], SILENT_AFTER_MS * 2);
    expect(a.of('waiting')).toEqual([]);
    a.send(seatCommand(0));
    expect(a.last('rejected')?.reason).toEqual({ code: 'gameNotStarted' });
  });
});
