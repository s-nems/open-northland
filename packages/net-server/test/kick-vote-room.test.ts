import { TICK_MS } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import { KICK_COUNTDOWN_MS, SILENT_AFTER_MS } from '../src/index.js';
import { MAX_HISTORY_AGE_MS } from '../src/relay/catch-up.js';
import { ackThrough, type MessageStage, type Peer, SETTINGS, stage } from './support/message-stage.js';

/** Kick votes in a running room of four or five, driven message by message. */

const NICKS = ['Ania', 'Bartek', 'Cezary', 'Dorota', 'Edek'] as const;
/** How long the clock runs before the first drop. */
const WARM_UP_MS = TICK_MS * 4;
const answeredPing = new WeakMap<Peer, number>();

/** Move the clock, answering every ping so the connected peers stay heard. */
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

const tokenOf = (i: number): string => `token-${i}-0123456789abcdef`;

/** `count` seated members in a running room, member i in seat i; a vacated seat goes idle. */
function roomOf(count: number) {
  const s = stage();
  const peers = NICKS.slice(0, count).map((nick, i) => s.introduce(tokenOf(i), nick));
  const [a] = peers;
  if (a === undefined) throw new Error('no creator');
  a.send({
    kind: 'createRoom',
    settings: { ...SETTINGS, kickedSeatMode: 'idle' },
    seats: peers.map((_, player) => ({
      player,
      mode: 'idle',
      offers: ['idle', 'ai', 'absent'],
      color: player,
    })),
  });
  const roomId = a.last('room')?.room.id ?? '';
  for (const peer of peers.slice(1)) peer.send({ kind: 'joinRoom', roomId });
  peers.forEach((peer, player) => {
    peer.send({ kind: 'claimSeat', player });
  });
  for (const peer of peers) peer.send({ kind: 'setReady', ready: true });
  a.send({ kind: 'start' });
  for (const peer of peers) peer.send({ kind: 'loaded', tick: 0, world: 0 });
  tick(s, peers, WARM_UP_MS);
  const member = (i: number): Peer => {
    const found = peers[i];
    if (found === undefined) throw new Error(`no peer ${i}`);
    return found;
  };
  const kick = (voter: Peer, player: number, yes = true): void => {
    voter.send({ kind: 'kick', player, yes });
  };
  return { ...s, peers, member, kick };
}

const lastTick = (peer: Peer): number => peer.last('frame')?.tick ?? 0;
const waitedNicks = (peer: Peer): string[] => (peer.last('waiting')?.for ?? []).map((entry) => entry.nick);

describe('kick votes against two dropped members', () => {
  it('waits for both, counts each down and votes on each alone, and holds the clock until both are kicked', () => {
    const s = roomOf(4);
    const [a, b, c, d] = [s.member(0), s.member(1), s.member(2), s.member(3)];
    s.relay.disconnect(c.handle);
    tick(s, [a, b], KICK_COUNTDOWN_MS / 2);
    s.relay.disconnect(d.handle);
    tick(s, [a, b], KICK_COUNTDOWN_MS / 2 + TICK_MS);
    const held = lastTick(a);
    const waited = a.last('waiting')?.for ?? [];
    expect(waited.find((entry) => entry.nick === 'Cezary')?.voteAfterMs).toBe(0);
    expect(waited.find((entry) => entry.nick === 'Dorota')?.voteAfterMs).toBeGreaterThan(0);

    s.kick(a, 3);
    expect(a.last('rejected')?.reason).toMatchObject({ code: 'voteNotOpen' });
    // Four players, two dropped: the electorate for each is the two still here.
    s.kick(a, 2);
    expect(b.last('kickVote')).toEqual({
      kind: 'kickVote',
      player: 2,
      nick: 'Cezary',
      yes: ['Ania'],
      needed: 2,
    });
    tick(s, [a, b], KICK_COUNTDOWN_MS / 2);
    s.kick(a, 3);
    expect(b.last('kickVote')).toEqual({
      kind: 'kickVote',
      player: 3,
      nick: 'Dorota',
      yes: ['Ania'],
      needed: 2,
    });
    expect(b.of('kicked')).toEqual([]);

    s.kick(b, 2);
    expect(b.last('kicked')).toMatchObject({ player: 2, nick: 'Cezary', cause: 'vote' });
    // Dorota's countdown and Ania's yes against her outlive Cezary's kick, and the clock stays held.
    tick(s, [a, b], TICK_MS * 2);
    expect(waitedNicks(a)).toEqual(['Dorota']);
    expect(a.last('waiting')?.for[0]?.voteAfterMs).toBe(0);
    expect(lastTick(a)).toBe(held);
    s.kick(b, 3);
    expect(b.last('kicked')).toMatchObject({ player: 3, nick: 'Dorota' });
    tick(s, [a, b], TICK_MS * 2);
    expect(lastTick(a)).toBeGreaterThan(held);
    expect(waitedNicks(a)).toEqual([]);
  });

  it('cancels only the vote against a dropped member that returns, and counts it among the others', () => {
    const s = roomOf(4);
    const [a, b, c, d] = [s.member(0), s.member(1), s.member(2), s.member(3)];
    const cezaryStood = lastTick(c);
    s.relay.disconnect(c.handle);
    s.relay.disconnect(d.handle);
    tick(s, [a, b], KICK_COUNTDOWN_MS + TICK_MS);
    s.kick(a, 2);
    s.kick(a, 3);

    const back = s.introduce(tokenOf(2), 'Cezary');
    back.send({ kind: 'loaded', tick: cezaryStood, world: 0 });
    expect(waitedNicks(a)).toEqual(['Dorota']);
    s.kick(b, 2);
    expect(b.last('rejected')?.reason).toEqual({ code: 'notWaitedFor', nick: 'Cezary' });
    // Three others now (Cezary is back): two yeses are still a majority, and Ania's stands.
    s.kick(b, 3);
    expect(a.last('kicked')).toMatchObject({ player: 3, nick: 'Dorota' });
    expect(a.of('kicked')).toHaveLength(1);
  });

  it('lets the last connected member kick every other alone', () => {
    const s = roomOf(4);
    const [a, b, c, d] = [s.member(0), s.member(1), s.member(2), s.member(3)];
    for (const peer of [b, c, d]) s.relay.disconnect(peer.handle);
    tick(s, [a], KICK_COUNTDOWN_MS + TICK_MS);
    const held = lastTick(a);
    for (const player of [1, 2, 3]) {
      s.kick(a, player);
      expect(a.last('kickVote')).toMatchObject({ player, yes: ['Ania'], needed: 1 });
      expect(a.last('kicked')).toMatchObject({ player });
    }
    tick(s, [a], TICK_MS * 2);
    expect(lastTick(a)).toBeGreaterThan(held);
  });

  it('leaves nobody to vote when every member dropped, and ends the room by its history age', () => {
    const s = roomOf(2);
    for (const peer of s.peers) s.relay.disconnect(peer.handle);
    tick(s, [], KICK_COUNTDOWN_MS + TICK_MS);
    expect(s.relay.roomCount).toBe(1);
    tick(s, [], MAX_HISTORY_AGE_MS);
    expect(s.relay.roomCount).toBe(0);
  });
});

describe('kick votes counted by connected voters', () => {
  it('drops a gone voter from the tally and passes on its return', () => {
    const s = roomOf(4);
    const [a, b, c, d] = [s.member(0), s.member(1), s.member(2), s.member(3)];
    s.relay.disconnect(d.handle);
    tick(s, [a, b, c], KICK_COUNTDOWN_MS + TICK_MS);
    s.kick(b, 3);
    expect(a.last('kickVote')).toMatchObject({ yes: ['Bartek'], needed: 2 });
    s.relay.disconnect(b.handle);
    expect(a.last('kickVote')).toMatchObject({ yes: [], needed: 2 });
    s.kick(a, 3);
    expect(c.last('kickVote')).toMatchObject({ yes: ['Ania'], needed: 2 });
    expect(c.of('kicked')).toEqual([]);
    s.introduce(tokenOf(1), 'Bartek');
    expect(c.last('kicked')).toMatchObject({ player: 3, nick: 'Dorota', cause: 'vote' });
  });

  it('passes when a member who did not vote drops and the majority shrinks', () => {
    const s = roomOf(5);
    const [a, b, c, d, e] = [s.member(0), s.member(1), s.member(2), s.member(3), s.member(4)];
    s.relay.disconnect(e.handle);
    tick(s, [a, b, c, d], KICK_COUNTDOWN_MS + TICK_MS);
    s.kick(a, 4);
    s.kick(b, 4);
    expect(c.last('kickVote')).toMatchObject({ yes: ['Ania', 'Bartek'], needed: 3 });
    s.relay.disconnect(d.handle);
    expect(c.last('kickVote')).toMatchObject({ yes: ['Ania', 'Bartek'], needed: 2 });
    expect(c.last('kicked')).toMatchObject({ player: 4, nick: 'Edek' });
  });

  it('takes a withdrawn yes back and refuses a withdrawal nobody cast', () => {
    const s = roomOf(4);
    const [a, b, c, d] = [s.member(0), s.member(1), s.member(2), s.member(3)];
    s.relay.disconnect(d.handle);
    tick(s, [a, b, c], KICK_COUNTDOWN_MS + TICK_MS);
    s.kick(b, 3, false);
    expect(b.last('rejected')?.reason).toEqual({ code: 'noVoteToWithdraw', nick: 'Dorota' });
    s.kick(a, 3);
    s.kick(a, 3, false);
    expect(c.last('kickVote')).toEqual({ kind: 'kickVote', player: 3, nick: 'Dorota', yes: [], needed: 2 });
    s.kick(b, 3);
    s.kick(c, 3);
    expect(a.last('kicked')).toMatchObject({ player: 3, nick: 'Dorota' });
  });
});

describe('kick votes as members come and go', () => {
  it('passes when a member who did not vote leaves the room and the majority shrinks', () => {
    const s = roomOf(5);
    const [a, b, c, d, e] = [s.member(0), s.member(1), s.member(2), s.member(3), s.member(4)];
    s.relay.disconnect(e.handle);
    tick(s, [a, b, c, d], KICK_COUNTDOWN_MS + TICK_MS);
    s.kick(a, 4);
    s.kick(b, 4);
    expect(c.last('kickVote')).toMatchObject({ yes: ['Ania', 'Bartek'], needed: 3 });
    d.send({ kind: 'leaveRoom' });
    expect(c.of('kicked')).toMatchObject([
      { player: 3, nick: 'Dorota', cause: 'left' },
      { player: 4, nick: 'Edek', cause: 'vote' },
    ]);
  });

  it('drops the yes of a voter that leaves and announces the tally with the smaller majority', () => {
    const s = roomOf(5);
    const [a, b, c, d, e] = [s.member(0), s.member(1), s.member(2), s.member(3), s.member(4)];
    s.relay.disconnect(e.handle);
    tick(s, [a, b, c, d], KICK_COUNTDOWN_MS + TICK_MS);
    s.kick(a, 4);
    expect(b.last('kickVote')).toMatchObject({ yes: ['Ania'], needed: 3 });
    a.send({ kind: 'leaveRoom' });
    expect(b.last('kickVote')).toEqual({ kind: 'kickVote', player: 4, nick: 'Edek', yes: [], needed: 2 });
    s.kick(b, 4);
    expect(c.of('kicked')).toEqual([expect.objectContaining({ nick: 'Ania', cause: 'left' })]);
    s.kick(c, 4);
    expect(d.last('kicked')).toMatchObject({ player: 4, nick: 'Edek', cause: 'vote' });
  });

  it('keeps the countdown and the yeses against a target that returns and drops again before loading', () => {
    const s = roomOf(4);
    const [a, b, c, d] = [s.member(0), s.member(1), s.member(2), s.member(3)];
    s.relay.disconnect(d.handle);
    tick(s, [a, b, c], KICK_COUNTDOWN_MS + TICK_MS);
    s.kick(a, 3);
    const back = s.introduce(tokenOf(3), 'Dorota');
    tick(s, [a, b, c], TICK_MS);
    expect(a.last('waiting')?.for).toEqual([{ nick: 'Dorota', reason: 'loading', voteAfterMs: 0 }]);
    s.relay.disconnect(back.handle);
    tick(s, [a, b, c], TICK_MS);
    expect(a.last('waiting')?.for).toEqual([{ nick: 'Dorota', reason: 'gone', voteAfterMs: 0 }]);
    s.kick(b, 3);
    expect(c.last('kicked')).toMatchObject({ player: 3, nick: 'Dorota', cause: 'vote' });
  });

  it('kicks no silent target that answered within the poll, on a yes or on a recount', () => {
    const s = roomOf(5);
    const [a, b, c, d, e] = [s.member(0), s.member(1), s.member(2), s.member(3), s.member(4)];
    tick(s, [a, b, d, e], SILENT_AFTER_MS + KICK_COUNTDOWN_MS + TICK_MS * 2);
    expect(a.last('waiting')?.for).toEqual([{ nick: 'Cezary', reason: 'silent', voteAfterMs: 0 }]);
    s.kick(a, 2);
    s.kick(b, 2);
    const ping = c.last('ping');
    if (ping === undefined) throw new Error('no ping');
    c.send({ kind: 'pong', t: ping.t });
    s.kick(d, 2);
    expect(d.last('rejected')?.reason).toEqual({ code: 'notWaitedFor', nick: 'Cezary' });
    s.relay.disconnect(e.handle);
    expect(a.last('kickVote')).toMatchObject({ nick: 'Cezary', yes: ['Ania', 'Bartek'], needed: 2 });
    expect(a.of('kicked')).toEqual([]);
    tick(s, [a, b, c, d], TICK_MS);
    expect(waitedNicks(a)).toEqual(['Edek']);
  });

  it('shows a member whose world loads again every open vote, after its waiting', () => {
    const s = roomOf(4);
    const [a, b, c, d] = [s.member(0), s.member(1), s.member(2), s.member(3)];
    s.relay.disconnect(d.handle);
    tick(s, [a, b, c], KICK_COUNTDOWN_MS + TICK_MS);
    s.kick(a, 3);
    const stood = lastTick(c);
    s.relay.disconnect(c.handle);
    const back = s.introduce(tokenOf(2), 'Cezary');
    expect(back.of('kickVote')).toEqual([]);
    back.send({ kind: 'loaded', tick: stood, world: 0 });
    const kinds = back.sent.map((message) => message.kind);
    expect(kinds.slice(kinds.lastIndexOf('waiting'))).toEqual(['waiting', 'kickVote']);
    expect(back.last('kickVote')).toEqual({
      kind: 'kickVote',
      player: 3,
      nick: 'Dorota',
      yes: ['Ania'],
      needed: 2,
    });
    s.kick(back, 3);
    expect(a.last('kicked')).toMatchObject({ player: 3, nick: 'Dorota', cause: 'vote' });
  });

  it('neither recounts nor takes a vote once the match has ended', () => {
    const s = roomOf(5);
    const [a, b, c, d, e] = [s.member(0), s.member(1), s.member(2), s.member(3), s.member(4)];
    s.relay.disconnect(e.handle);
    tick(s, [a, b, c, d], KICK_COUNTDOWN_MS + TICK_MS);
    s.kick(a, 4);
    s.kick(b, 4);
    const last = lastTick(a);
    for (const peer of [a, b, c, d]) {
      ackThrough(peer, 1, last);
      peer.send({ kind: 'finish', tick: last, world: 0, hash: '12345678' });
    }
    expect(a.last('ended')).toMatchObject({ tick: last });
    s.relay.disconnect(d.handle);
    s.kick(c, 4);
    expect(c.last('rejected')?.reason).toEqual({ code: 'matchEnded' });
    expect(a.of('kicked')).toEqual([]);
    const back = s.introduce(tokenOf(3), 'Dorota');
    back.send({ kind: 'loaded', tick: last, world: 0 });
    expect(back.last('ended')).toMatchObject({ tick: last });
    expect(back.of('kickVote')).toEqual([]);
  });
});
