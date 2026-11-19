import { PROTOCOL_VERSION, TICK_MS } from '@open-northland/net-protocol';
import {
  CATCH_UP_SHARE,
  LAG_BEHIND_MS,
  LOADING_STALL_MS,
  SILENT_AFTER_MS,
  SLOW_GRACE_MS,
  SNAPSHOT_REFRESH_MS,
  SNAPSHOT_RETRY_MS,
  SNAPSHOT_UPLOAD_MAX_MS,
  STATUS_LOG_INTERVAL_MS,
} from '@open-northland/net-server';
import { describe, expect, it } from 'vitest';
import { GOVERNED_GAP_MS, NOTABLE_EPISODE_MS } from '../../src/relay/game/clock-log.js';
import { BYTES_PER_KIB } from '../../src/relay/relay-log.js';
import { MAX_HISTORY_AGE_MS } from '../../src/relay/snapshots/catch-up.js';
import {
  ackThrough,
  digest,
  LOAD,
  type MessageStage,
  type Peer,
  SEATS,
  SETTINGS,
  stage,
  TOKEN_A,
  TOKEN_B,
  TOKEN_C,
} from '../support/message-stage.js';

/** The diagnostic lines an operator reads to see who plays, in which room, and for how long. */

const SECOND_MS = 1000;
const SILENT_SECONDS = SILENT_AFTER_MS / SECOND_MS;
/** Heard but acknowledging nothing this long, a member lags, turns slow after the grace, and stays
 *  governed for longer than a hiccup. */
const GOVERNED_SECONDS = (LAG_BEHIND_MS + SLOW_GRACE_MS + NOTABLE_EPISODE_MS) / SECOND_MS + 2;
/** RFC 6455: the connection closed without a close frame, or normally with a reason. */
const ABNORMAL_CLOSURE = 1006;
const NORMAL_CLOSURE = 1000;
const SNAPSHOT_BYTES = Buffer.from('opaque snapshot').toString('base64');
const FAULTY_TOKEN = 'faulty-token-0123456789';
/** What of a donor's upload had arrived when its retry window ended. */
const ARRIVED_KIB = 300;
const BOOT_PROGRESS = 40;

function logged() {
  const lines: { event: string; fields: Record<string, unknown> }[] = [];
  const s = stage(true, (event, fields = {}) => lines.push({ event, fields }));
  const events = (name: string) => lines.filter((line) => line.event === name).map((line) => line.fields);
  return { ...s, lines, events };
}

function seatedPair(s: ReturnType<typeof logged>) {
  const a = s.introduce(TOKEN_A, 'Ania');
  const b = s.introduce(TOKEN_B, 'Bartek');
  a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
  const roomId = a.last('room')?.room.id ?? '';
  b.send({ kind: 'joinRoom', roomId });
  a.send({ kind: 'claimSeat', player: 0 });
  b.send({ kind: 'claimSeat', player: 1 });
  for (const peer of [a, b]) peer.send({ kind: 'setReady', ready: true });
  return { a, b, roomId };
}

/** A started room both members of `seatedPair` loaded, its clock running. */
function runningPair(s: ReturnType<typeof logged>) {
  const pair = seatedPair(s);
  pair.a.send({ kind: 'start' });
  for (const peer of [pair.a, pair.b]) peer.send({ kind: 'loaded', tick: 0, world: 0 });
  s.advance(TICK_MS);
  return pair;
}

/** The last tick each peer acknowledged. */
const acked = new WeakMap<Peer, number>();

/** Each peer acknowledges every frame it has received. */
function acknowledge(peers: readonly Peer[]): void {
  for (const peer of peers) {
    const from = acked.get(peer) ?? 0;
    const tick = peer.last('frame')?.tick ?? from;
    ackThrough(peer, from + 1, tick);
    acked.set(peer, tick);
  }
}

/** `seconds` of play in whole seconds: after each poll, `ponging` answer the relay's ping and `acking`
 *  acknowledge every frame. */
function play(s: MessageStage, seconds: number, acking: readonly Peer[], ponging = acking): void {
  for (let second = 0; second < seconds; second++) {
    s.advance(SECOND_MS);
    for (const peer of ponging) {
      const ping = peer.last('ping');
      if (ping !== undefined) peer.send({ kind: 'pong', t: ping.t });
    }
    acknowledge(acking);
  }
}

describe('relay log', () => {
  it('follows a room from creation through a played match to its drop', () => {
    const s = logged();
    const { a, b, roomId } = seatedPair(s);
    const room = { room: roomId, name: SETTINGS.name };
    expect(s.events('room created')).toEqual([{ ...room, by: 'Ania', world: 'zatoka', seats: SEATS.length }]);
    expect(s.events('room joined')).toEqual([{ ...room, nick: 'Bartek', members: 2 }]);

    s.advance(30 * SECOND_MS);
    a.send({ kind: 'start' });
    expect(s.events('game starting')).toEqual([
      { ...room, players: ['Ania', 'Bartek'], world: 'zatoka', client: 'fixture-client', lobbySeconds: 30 },
    ]);
    s.advance(20 * SECOND_MS);
    // Answered pings keep both members heard, so the clock does not wait on them as silent.
    for (const peer of [a, b]) peer.send({ kind: 'pong', t: peer.last('ping')?.t ?? 0 });
    for (const peer of [a, b]) peer.send({ kind: 'loaded', tick: 0, world: 0 });
    s.advance(TICK_MS);
    expect(s.events('game running')).toEqual([{ ...room, loadSeconds: 20 }]);

    for (const peer of [a, b]) peer.send({ kind: 'ack', load: LOAD, tick: 1, world: 0, digest: digest(1) });
    s.advance(60 * SECOND_MS);
    for (const peer of [a, b]) peer.send({ kind: 'finish', tick: 1, world: 0, hash: '12345678' });
    s.advance(TICK_MS);
    // The game plays on past its result, so its figures go on too.
    expect(s.lines.at(-1)?.event).toBe('match decided');
    expect(s.events('match decided')).toEqual([{ ...room, tick: 1, playedSeconds: 60 }]);

    a.send({ kind: 'leaveRoom' });
    b.send({ kind: 'leaveRoom' });
    expect(s.events('room left').map(({ nick, cause, members }) => ({ nick, cause, members }))).toEqual([
      { nick: 'Ania', cause: 'left', members: 1 },
      { nick: 'Bartek', cause: 'left', members: 0 },
    ]);
    expect(s.lines.slice(-2).map((line) => line.event)).toEqual(['room status', 'room dropped']);
    expect(s.events('room dropped')).toEqual([
      { ...room, state: 'running', members: 0, ageSeconds: 110, playedSeconds: 60 },
    ]);
  });

  it('notes a socket that drops and returns in two lines, and where a departed seat went', () => {
    const s = logged();
    const { a, b, roomId } = seatedPair(s);
    a.send({ kind: 'start' });
    for (const peer of [a, b]) peer.send({ kind: 'loaded', tick: 0, world: 0 });
    s.advance(SECOND_MS);
    b.send({ kind: 'pong', t: b.last('ping')?.t ?? 0 });
    const quietMs = 2 * SECOND_MS;
    s.advance(quietMs);

    const mark = s.lines.length;
    // The client gave up on a link it heard nothing on, and said so.
    s.relay.disconnect(b.handle, { code: NORMAL_CLOSURE, reason: 'linkQuiet' });
    s.introduce(TOKEN_B, 'Bartek');
    expect(s.lines.slice(mark)).toEqual([
      {
        event: 'disconnect',
        fields: {
          nick: 'Bartek',
          room: roomId,
          connectedSeconds: 3,
          clients: 1,
          closeCode: NORMAL_CLOSURE,
          closeReason: 'linkQuiet',
          quietMs,
          roundTripMs: 0,
        },
      },
      { event: 'hello', fields: { nick: 'Bartek', rejoined: true, room: roomId } },
    ]);

    a.send({ kind: 'leaveRoom' });
    expect(s.events('room left')).toEqual([
      {
        room: roomId,
        name: SETTINGS.name,
        nick: 'Ania',
        cause: 'left',
        state: 'running',
        members: 1,
        seatTo: 'idle',
      },
    ]);
  });

  it('names where a boot stood still when its seat is handed over', () => {
    const s = logged();
    // The first status line comes while the boot still stands.
    s.advance(STATUS_LOG_INTERVAL_MS - LOADING_STALL_MS / 2);
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek');
    const c = s.introduce(TOKEN_C, 'Cezary');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    for (const peer of [b, c]) peer.send({ kind: 'joinRoom', roomId: a.last('room')?.room.id });
    for (const [player, peer] of [a, b, c].entries()) peer.send({ kind: 'claimSeat', player });
    for (const peer of [a, b, c]) peer.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    for (const peer of [a, b]) peer.send({ kind: 'loaded', tick: 0, world: 0 });
    c.send({ kind: 'loading', progress: BOOT_PROGRESS });
    while (s.events('room status').length === 0) s.advance(SECOND_MS);
    expect(s.events('room status').at(-1)?.members).toContainEqual(
      expect.objectContaining({ nick: 'Cezary', loading: BOOT_PROGRESS }),
    );
    s.advance(LOADING_STALL_MS);
    expect(s.events('room left')).toEqual([
      expect.objectContaining({ nick: 'Cezary', cause: 'loadingTimedOut', loading: BOOT_PROGRESS }),
    ]);
  });

  it('names the members a digest vote put out of sync', () => {
    const s = logged();
    const a = s.introduce(TOKEN_A, 'Ania');
    const b = s.introduce(TOKEN_B, 'Bartek');
    const c = s.introduce(TOKEN_C, 'Cezary');
    a.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    const roomId = a.last('room')?.room.id ?? '';
    for (const peer of [b, c]) peer.send({ kind: 'joinRoom', roomId });
    for (const [player, peer] of [a, b, c].entries()) peer.send({ kind: 'claimSeat', player });
    for (const peer of [a, b, c]) peer.send({ kind: 'setReady', ready: true });
    a.send({ kind: 'start' });
    for (const peer of [a, b, c]) peer.send({ kind: 'loaded', tick: 0, world: 0 });
    s.advance(TICK_MS);
    ackThrough(a, 1, 1, 1);
    ackThrough(b, 1, 1, 1);
    ackThrough(c, 1, 1, 9);

    expect(s.events('desync')).toEqual([
      {
        room: roomId,
        name: SETTINGS.name,
        tick: 1,
        diverged: ['Cezary'],
        reference: 'Ania',
        domains: ['rng'],
      },
    ]);
  });

  it('logs a notable hold, governed episode or pause when it ends, and only counts a short one', () => {
    const s = logged();
    const { a, b, roomId } = runningPair(s);
    const room = { room: roomId, name: SETTINGS.name };
    // Bartek answers nothing: silent, and the clock holds for him until he is heard again.
    play(s, SILENT_SECONDS + NOTABLE_EPISODE_MS / SECOND_MS, [a]);
    play(s, 2, [a, b]);
    const [held] = s.events('held');
    expect(held).toEqual({
      ...room,
      tick: expect.any(Number),
      ms: held?.ms,
      for: [{ nick: 'Bartek', silentMs: held?.ms }],
    });
    expect(held?.ms).toBeGreaterThanOrEqual(NOTABLE_EPISODE_MS);
    play(s, SILENT_SECONDS + 1, [a]);
    play(s, 2, [a, b]);
    expect(s.events('held')).toHaveLength(1);

    // Heard but acknowledging nothing, he trails the clock and the room is paced for him; paced again
    // soon after his release, that is the same episode, logged once the clock has run free a while.
    for (let run = 0; run < 2; run++) {
      play(s, GOVERNED_SECONDS, [a], [a, b]);
      play(s, 2, [a, b]);
    }
    expect(s.events('governed')).toEqual([]);
    play(s, GOVERNED_GAP_MS / SECOND_MS, [a, b]);
    const [governed] = s.events('governed');
    expect(governed).toEqual({
      ...room,
      tick: expect.any(Number),
      endTick: expect.any(Number),
      ms: governed?.ms,
      runs: 2,
      speed: SETTINGS.speed,
      minSpeed: CATCH_UP_SHARE,
      for: [{ nick: 'Bartek', lagMs: governed?.ms }],
    });
    expect(governed?.ms).toBeGreaterThanOrEqual(2 * NOTABLE_EPISODE_MS);

    a.send({ kind: 'clock', paused: true });
    play(s, NOTABLE_EPISODE_MS / SECOND_MS + 1, [a, b]);
    b.send({ kind: 'clock', paused: false, speed: 2 });
    play(s, 1, [a, b]);
    expect(s.events('paused')).toEqual([
      { ...room, tick: expect.any(Number), ms: NOTABLE_EPISODE_MS + SECOND_MS, by: 'Ania' },
    ]);

    while (s.events('room status').length === 0) play(s, 1, [a, b]);
    const [status] = s.events('room status');
    expect(status).toMatchObject({
      speed: 2,
      speedBy: 'Bartek',
      holds: 2,
      governedMs: governed?.ms,
      minSpeed: CATCH_UP_SHARE,
      pausedMs: NOTABLE_EPISODE_MS + SECOND_MS,
    });
    expect(status?.heldMs).toBeGreaterThan(Number(held?.ms));
    expect(status?.members).toEqual([
      expect.not.objectContaining({ silentMs: expect.anything() }),
      expect.objectContaining({ silentMs: status?.heldMs, governedMs: governed?.ms }),
    ]);
  });

  it('logs each snapshot refresh once, a donor that did not answer in time, and an upload of no use', () => {
    const s = logged();
    const { a, b, roomId } = runningPair(s);
    const room = { room: roomId, name: SETTINGS.name };
    const nick = (peer: Peer) => (peer === a ? 'Ania' : 'Bartek');
    let first: Peer | undefined;
    while (first === undefined) {
      play(s, 1, [a, b]);
      first = [a, b].find((peer) => peer.of('snapshotRequest').length > 0);
    }
    const second = first === a ? b : a;
    // The first donor sends nothing within the retry window, so the request moves on; the second's
    // upload is still arriving when the upload cap ends.
    while (second.of('snapshotRequest').length === 0) play(s, 1, [a, b]);
    while (first.of('snapshotRequest').length === 1) {
      // Its pongs and acknowledgements wait behind the upload; the transport reports its progress.
      s.relay.receiving(second.handle, ARRIVED_KIB * BYTES_PER_KIB);
      play(s, 1, [first]);
    }
    expect(s.events('snapshot unanswered')).toEqual([
      { ...room, donor: nick(first), askedMs: SNAPSHOT_RETRY_MS },
      { ...room, donor: nick(second), askedMs: SNAPSHOT_UPLOAD_MAX_MS, receivingKib: ARRIVED_KIB },
    ]);

    const tick = second.last('frame')?.tick ?? 0;
    second.send({ kind: 'blob', type: 'snapshot', world: 0, to: null, tick, bytes: SNAPSHOT_BYTES });
    expect(s.events('snapshot')).toEqual([
      {
        ...room,
        from: nick(second),
        tick,
        kib: 0,
        askedMs: SNAPSHOT_RETRY_MS + SNAPSHOT_UPLOAD_MAX_MS,
        asks: 3,
      },
    ]);
    // The first donor's late answer is older than the cache. A refused upload is a line once a round;
    // the round's snapshot counts the rest.
    const upload = { kind: 'blob', type: 'snapshot', world: 0, to: null, bytes: SNAPSHOT_BYTES } as const;
    first.send({ ...upload, tick: tick - 1 });
    first.send({ ...upload, tick: tick + 1 });
    expect(s.events('snapshot refused')).toEqual([
      { ...room, from: nick(first), tick: tick - 1, reason: 'stale' },
    ]);
    let next: Peer | undefined;
    while (next === undefined) {
      play(s, 1, [a, b]);
      next = [a, b].find((peer) => peer.of('snapshotRequest').length > 2);
    }
    next.send({ ...upload, tick: next.last('frame')?.tick ?? 0 });
    expect(s.events('snapshot').at(-1)).toMatchObject({ from: nick(next), refused: 2 });
  });

  it('names each donor once a round, and drops the room whose history outlived every request', () => {
    const s = logged();
    // The refresh comes due between two status lines.
    s.advance(STATUS_LOG_INTERVAL_MS / 2);
    const { a, b, roomId } = runningPair(s);
    while (s.events('room dropped').length === 0) play(s, 1, [a, b]);
    expect(s.events('snapshot unanswered').map(({ donor }) => donor)).toEqual(['Ania', 'Bartek']);
    // A status line while the round is open says so, and so does the last one, at the drop.
    const statuses = s.events('room status');
    expect(statuses.at(-2)?.snapshotPending).toEqual({
      askedMs: expect.any(Number),
      asks: expect.any(Number),
    });
    expect(statuses.at(-1)?.snapshotPending).toMatchObject({
      askedMs: MAX_HISTORY_AGE_MS - SNAPSHOT_REFRESH_MS,
    });
    expect(s.events('room dropped')).toEqual([
      expect.objectContaining({ room: roomId, state: 'running', reason: { code: 'historyAge' } }),
    ]);
  });

  it('sums up each member over the status interval, and starts the next one from nothing', () => {
    const s = logged();
    const { a, b, roomId } = runningPair(s);
    // Two round trips each, of 100 and 300 ms; no pong after them.
    for (const tripMs of [100, 300]) {
      s.advance(SECOND_MS);
      const stamps = [a, b].map((peer) => peer.last('ping')?.t ?? 0);
      s.advance(tripMs);
      for (const [i, peer] of [a, b].entries()) peer.send({ kind: 'pong', t: stamps[i] });
      acknowledge([a, b]);
    }
    // An acknowledgement the relay cannot take is counted against its sender.
    a.send({ kind: 'ack', tick: (acked.get(a) ?? 0) + 2, digest: digest(1), world: 0, load: LOAD });
    play(s, 1, [a, b], []);
    // Bartek's socket drops; he is waited for from the next poll until his world is back.
    const goneSeconds = 3;
    s.relay.disconnect(b.handle, { code: ABNORMAL_CLOSURE });
    play(s, goneSeconds, [a], []);
    const back = s.introduce(TOKEN_B, 'Bartek');
    const tick = acked.get(b) ?? 0;
    back.send({ kind: 'loaded', tick, world: 0 });
    acked.set(back, tick);
    while (s.events('room status').length === 0) play(s, 1, [a, back], []);

    const goneMs = (goneSeconds - 1) * SECOND_MS;
    const link = { roundTripMeanMs: 200, roundTripMaxMs: 300, delayMaxTicks: expect.any(Number) };
    const load = {
      behindMaxTicks: expect.any(Number),
      tickMaxMs: LOAD.tickMs,
      bufferedMaxTicks: LOAD.buffered,
    };
    const statuses = s.events('room status');
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toMatchObject({ room: roomId, speed: SETTINGS.speed, holds: 1, heldMs: goneMs });
    expect(statuses[0]?.members).toEqual([
      { nick: 'Ania', seat: 0, ...link, ...load, refused: { 'ack:ackOutOfOrder': 1 } },
      { nick: 'Bartek', seat: 1, ...link, ...load, drops: 1, goneMs },
    ]);

    while (s.events('room status').length < 2) play(s, 1, [a, back]);
    const trips = { roundTripMeanMs: expect.any(Number), roundTripMaxMs: expect.any(Number) };
    expect(s.events('room status').at(-1)?.members).toEqual([
      { nick: 'Ania', seat: 0, ...trips, delayMaxTicks: expect.any(Number), ...load },
      { nick: 'Bartek', seat: 1, ...trips, delayMaxTicks: expect.any(Number), ...load },
    ]);
  });

  it('names a replaced or refused connection, and only counts sockets that never said who they are', () => {
    const s = logged();
    const first = s.introduce(TOKEN_A, 'Ania');
    s.introduce(TOKEN_A, 'Ania');
    expect(s.events('hello').at(-1)).toEqual({ nick: 'Ania', rejoined: false, replaced: true, quietMs: 0 });
    expect(first.closed()).toBe('replaced');

    s.relay.disconnect(s.peer().handle, { code: ABNORMAL_CLOSURE });
    s.peer().send({ kind: 'listRooms' });
    s.peer().send({ kind: 'hello', protocol: PROTOCOL_VERSION + 1, token: TOKEN_C, nick: 'Cezary' });
    expect(s.events('hello refused')).toEqual([{ nick: 'Cezary', protocol: PROTOCOL_VERSION + 1 }]);
    expect(s.events('disconnect')).toEqual([]);
    s.advance(STATUS_LOG_INTERVAL_MS);
    expect(s.events('status')).toEqual([
      {
        clients: 1,
        rooms: { lobby: 0, running: 0 },
        playing: 0,
        anonymous: 3,
        pollMaxMs: STATUS_LOG_INTERVAL_MS,
        latePolls: 1,
      },
    ]);
  });

  it('ends a faulty room once, and every room with its last figures when the relay stops', () => {
    const s = logged();
    const faulty = runningPair(s);
    const room = faulty.a.handle.room;
    if (room === null) throw new Error('no room');
    room.advance = () => {
      throw new Error('broken room state');
    };
    // The room's last figures fail too; it is dropped all the same, and the next poll is quiet.
    room.noteDrop = () => {
      throw new Error('broken figures');
    };
    s.advance(TICK_MS);
    s.advance(TICK_MS);
    const fault = { room: faulty.roomId, stack: expect.any(String) };
    expect(s.events('room fault')).toEqual([
      { ...fault, error: 'Error: broken room state' },
      { ...fault, error: 'Error: broken figures' },
    ]);
    expect(s.events('room dropped')).toEqual([
      expect.objectContaining({ room: faulty.roomId, reason: { code: 'relayFault' } }),
    ]);

    // Bartek goes silent, and the relay stops while the room holds for him.
    const b = s.introduce(TOKEN_B, 'Bartek');
    const c = s.introduce(TOKEN_C, 'Cezary');
    b.send({ kind: 'createRoom', settings: SETTINGS, seats: SEATS });
    c.send({ kind: 'joinRoom', roomId: b.last('room')?.room.id });
    b.send({ kind: 'claimSeat', player: 0 });
    c.send({ kind: 'claimSeat', player: 1 });
    for (const peer of [b, c]) peer.send({ kind: 'setReady', ready: true });
    b.send({ kind: 'start' });
    for (const peer of [b, c]) peer.send({ kind: 'loaded', tick: 0, world: 0 });
    play(s, SILENT_SECONDS + NOTABLE_EPISODE_MS / SECOND_MS + 2, [c]);
    const mark = s.lines.length;
    s.relay.stop();
    expect(s.lines.slice(mark).map((line) => line.event)).toEqual([
      'held',
      'room status',
      'room dropped',
      'status',
    ]);
    // The drop closed the hold before the last status line counted it.
    expect(s.events('room status').at(-1)).toMatchObject({ holds: 1, heldMs: s.events('held').at(-1)?.ms });
    expect(s.events('room dropped').at(-1)).toMatchObject({ reason: { code: 'serverRestart' } });
    expect(b.of('error')).toEqual([]);
  });

  it('counts clients, rooms, players and its own late polls on a cadence, a recurring fault once', () => {
    const s = logged();
    s.advance(STATUS_LOG_INTERVAL_MS);
    expect(s.events('status')).toEqual([]);

    const { a, b } = seatedPair(s);
    s.introduce(TOKEN_C, 'Cezary');
    const faulty = s.relay.connect({
      send: (message) => {
        if (message.kind === 'ping') throw new Error('socket gone');
      },
      close: () => undefined,
    });
    s.relay.receive(faulty, {
      kind: 'hello',
      protocol: PROTOCOL_VERSION,
      token: FAULTY_TOKEN,
      nick: 'Faulty',
    });
    a.send({ kind: 'start' });
    for (const peer of [a, b]) peer.send({ kind: 'loaded', tick: 0, world: 0 });
    const polls = STATUS_LOG_INTERVAL_MS / SECOND_MS;
    for (let poll = 0; poll < polls; poll++) s.advance(SECOND_MS);
    expect(s.events('poll fault')).toEqual([
      { nick: 'Faulty', error: 'Error: socket gone', stack: expect.stringContaining('socket gone') },
    ]);
    // Every poll of the test's one-second steps is late.
    expect(s.events('status')).toEqual([
      {
        clients: 4,
        rooms: { lobby: 0, running: 1 },
        playing: 2,
        pollMaxMs: SECOND_MS,
        latePolls: polls,
        repeatedFaults: expect.any(Number),
      },
    ]);
    // Neither player has said a word since loading: the hold is still open, and has lasted since then.
    expect(s.events('room status').at(-1)).toMatchObject({
      waitingFor: [
        { nick: 'Ania', reason: 'silent' },
        { nick: 'Bartek', reason: 'silent' },
      ],
      waitingMs: STATUS_LOG_INTERVAL_MS - (SILENT_SECONDS + 1) * SECOND_MS,
    });
  });
});
