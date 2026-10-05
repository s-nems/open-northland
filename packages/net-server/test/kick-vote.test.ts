import { describe, expect, it } from 'vitest';
import { KickVotes } from '../src/relay/kick-vote.js';
import { createMember, type Member } from '../src/relay/member.js';
import { KICK_COUNTDOWN_MS, Waiting } from '../src/relay/waiting.js';

const TARGET_SEAT = 0;
const STILL_WAITED = () => true;
const ANSWERED = () => false;

/** `count` seated members, seat i for the i-th, with the first waited for and its vote open. */
function room(count: number) {
  const peers = Array.from({ length: count }, (_, seat) => {
    const member = createMember(String(seat), `Player${seat}`, 0, { delayTicks: 1, roundTripMs: 0 });
    member.seat = seat;
    return member;
  });
  const members = new Map(peers.map((member) => [member.token, member]));
  const [target] = peers;
  if (target === undefined) throw new Error('no target');
  const waiting = new Waiting();
  waiting.update([{ token: target.token, nick: target.nick, reason: 'gone' }], 0);
  target.connected = false;
  const votes = new KickVotes();
  const cast = (voter: Member | undefined, yes = true, waitedNow = STILL_WAITED) => {
    if (voter === undefined) throw new Error('no voter');
    return votes.cast(members, waiting, voter, TARGET_SEAT, yes, KICK_COUNTDOWN_MS, waitedNow);
  };
  return { peers, members, waiting, votes, cast, target };
}

describe('kick electorate', () => {
  it.each(['disconnected', 'removed'] as const)('excludes votes from %s members', (status) => {
    const { peers, members, cast, target } = room(7);
    const [, a, b, c, d] = peers;
    for (const voter of [a, b]) expect(cast(voter)).toMatchObject({ kicked: null });
    for (const voter of [a, b]) {
      if (voter === undefined) continue;
      if (status === 'removed') members.delete(voter.token);
      else voter.connected = false;
    }
    // Four connected others (removed or dropped voters are not among them): three yeses pass.
    expect(cast(c)).toMatchObject({ tally: { yes: [c?.nick], needed: 3 }, kicked: null });
    expect(cast(d)).toMatchObject({ tally: { needed: 3 }, kicked: null });
    expect(cast(peers[5])).toMatchObject({ kicked: target });
  });

  it('needs both of two remaining players, and 2 of 3', () => {
    const three = room(3);
    expect(three.cast(three.peers[1])).toMatchObject({ tally: { needed: 2 }, kicked: null });
    expect(three.cast(three.peers[2])).toMatchObject({ kicked: three.target });

    const four = room(4);
    expect(four.cast(four.peers[1])).toMatchObject({ tally: { needed: 2 }, kicked: null });
    expect(four.cast(four.peers[2])).toMatchObject({ kicked: four.target });
  });
});

describe('kick withdrawal', () => {
  it('takes a yes back and refuses a withdrawal from a member that never voted', () => {
    const { peers, cast, target } = room(4);
    const [, a, b, c] = peers;
    expect(cast(b, false)).toEqual({ refused: { code: 'noVoteToWithdraw', nick: 'Player0' } });
    cast(a);
    expect(cast(a, false)).toEqual({
      tally: { kind: 'kickVote', player: TARGET_SEAT, nick: 'Player0', yes: [], needed: 2 },
      kicked: null,
    });
    expect(cast(a, false)).toMatchObject({ refused: { code: 'noVoteToWithdraw' } });
    cast(b);
    expect(cast(c)).toMatchObject({ tally: { yes: ['Player2', 'Player3'] }, kicked: target });
  });
});

describe('kick recount', () => {
  it('stops counting a dropped voter, counts it again on its return, and passes when the electorate shrinks', () => {
    const { peers, members, votes, cast, target } = room(5);
    const [, a, b, c, d] = peers;
    if (a === undefined || b === undefined || c === undefined || d === undefined) throw new Error('peers');
    cast(a);
    cast(b);
    expect(votes.recount(members, STILL_WAITED)).toEqual({ moved: [], passed: null });

    a.connected = false;
    expect(votes.recount(members, STILL_WAITED)).toEqual({
      moved: [{ kind: 'kickVote', player: TARGET_SEAT, nick: target.nick, yes: [b.nick], needed: 2 }],
      passed: null,
    });
    a.connected = true;
    expect(votes.recount(members, STILL_WAITED).moved).toEqual([
      { kind: 'kickVote', player: TARGET_SEAT, nick: target.nick, yes: [a.nick, b.nick], needed: 3 },
    ]);

    // A non-voter dropping leaves three connected others: two yeses are a majority now.
    d.connected = false;
    expect(votes.recount(members, STILL_WAITED)).toMatchObject({
      moved: [{ yes: [a.nick, b.nick], needed: 2 }],
      passed: { target, player: TARGET_SEAT },
    });
  });

  it('passes no vote against a target that answered since the waited set was refreshed', () => {
    const { peers, cast, target } = room(3);
    const [, a, b] = peers;
    cast(a);
    expect(cast(b, true, ANSWERED)).toEqual({ refused: { code: 'notWaitedFor', nick: target.nick } });
    expect(cast(b)).toMatchObject({ kicked: target });

    const again = room(5);
    const [, c, d, e] = again.peers;
    again.cast(c);
    again.cast(d);
    if (e === undefined) throw new Error('peers');
    e.connected = false;
    expect(again.votes.recount(again.members, ANSWERED)).toMatchObject({
      moved: [{ needed: 2 }],
      passed: null,
    });
    expect(again.votes.recount(again.members, STILL_WAITED).passed).toEqual({
      target: again.target,
      player: TARGET_SEAT,
    });
  });

  it('closes the votes against a member no longer waited for', () => {
    const { members, peers, votes, cast } = room(3);
    cast(peers[1]);
    votes.retain(() => false);
    expect(votes.recount(members, STILL_WAITED)).toEqual({ moved: [], passed: null });
  });
});
