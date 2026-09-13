import { describe, expect, it } from 'vitest';
import { KICK_COUNTDOWN_MS, Waiting } from '../src/relay/waiting.js';

describe('departed identity cleanup', () => {
  it('removes its target countdown and its votes for other targets', () => {
    const waiting = new Waiting();
    waiting.update(
      [
        { token: 'a', nick: 'A', reason: 'gone' },
        { token: 'b', nick: 'B', reason: 'gone' },
      ],
      0,
    );
    waiting.vote('a', 'b');
    waiting.vote('b', 'a');
    waiting.forget('a');
    expect(waiting.isWaitedFor('a')).toBe(false);
    expect([...waiting.vote('b', 'c')]).toEqual(['c']);
    waiting.update([{ token: 'b', nick: 'B', reason: 'gone' }], KICK_COUNTDOWN_MS);
    expect(waiting.message(KICK_COUNTDOWN_MS).for).toEqual([{ nick: 'B', reason: 'gone', voteAfterMs: 0 }]);
  });
});
