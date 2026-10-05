import { describe, expect, it } from 'vitest';
import { KickVotes } from '../src/relay/kick-vote.js';
import { createMember } from '../src/relay/member.js';
import { KICK_COUNTDOWN_MS, Waiting } from '../src/relay/waiting.js';

describe('departed identity cleanup', () => {
  it('removes its target countdown and its votes for other targets', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((token, seat) => {
      const member = createMember(token, token.toUpperCase(), 0, { delayTicks: 1, roundTripMs: 0 });
      member.seat = seat;
      return member;
    });
    if (a === undefined || b === undefined || c === undefined) throw new Error('members');
    const members = new Map([a, b, c].map((member) => [member.token, member]));
    const waiting = new Waiting();
    waiting.update(
      [
        { token: 'a', nick: 'A', reason: 'gone' },
        { token: 'b', nick: 'B', reason: 'gone' },
      ],
      0,
    );
    const votes = new KickVotes();
    votes.cast(members, waiting, b, 0, true, KICK_COUNTDOWN_MS);
    votes.cast(members, waiting, a, 1, true, KICK_COUNTDOWN_MS);
    waiting.forget('a');
    votes.forget('a');
    members.delete('a');
    expect(waiting.isWaitedFor('a')).toBe(false);
    expect(votes.cast(members, waiting, c, 1, true, KICK_COUNTDOWN_MS)).toMatchObject({
      tally: { yes: ['C'] },
    });
    waiting.update([{ token: 'b', nick: 'B', reason: 'gone' }], KICK_COUNTDOWN_MS);
    expect(waiting.message(KICK_COUNTDOWN_MS).for).toEqual([{ nick: 'B', reason: 'gone', voteAfterMs: 0 }]);
  });
});
