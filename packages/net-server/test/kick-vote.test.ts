import { describe, expect, it } from 'vitest';
import { castKickVote } from '../src/relay/kick-vote.js';
import { createMember } from '../src/relay/member.js';
import { KICK_COUNTDOWN_MS, Waiting } from '../src/relay/waiting.js';

describe('kick electorate', () => {
  it.each(['disconnected', 'removed'] as const)('excludes votes from %s members', (status) => {
    const peers = Array.from({ length: 7 }, (_, seat) => {
      const member = createMember(String(seat), `Player${seat}`, 0, { delayTicks: 1, roundTripMs: 0 });
      member.seat = seat;
      return member;
    });
    const [target, a, b, c, d] = peers;
    if (!target || !a || !b || !c || !d) throw new Error('missing members');
    const members = new Map(peers.map((member) => [member.token, member]));
    const waiting = new Waiting();
    waiting.update([{ token: target.token, nick: target.nick, reason: 'loading' }], 0);
    for (const voter of [a, b]) {
      expect(castKickVote(members, waiting, voter, 0, KICK_COUNTDOWN_MS)).toMatchObject({ kicked: null });
    }
    for (const voter of [a, b]) {
      if (status === 'removed') members.delete(voter.token);
      else voter.connected = false;
    }
    expect(castKickVote(members, waiting, c, 0, KICK_COUNTDOWN_MS)).toMatchObject({
      tally: { yes: [c.nick], needed: 2 },
      kicked: null,
    });
    expect(castKickVote(members, waiting, d, 0, KICK_COUNTDOWN_MS)).toMatchObject({ kicked: target });
  });
});
