import { describe, expect, it } from 'vitest';
import { createSeatFeeds } from '../src/hud/tool-panel/messages/seat-feeds.js';
import type { MessageText } from '../src/hud/tool-panel/messages/text.js';
import { type PendingMessage, USER_MESSAGE_TYPE } from '../src/hud/tool-panel/messages/types.js';

const TICK = 100;
const TEXT = (): MessageText => ({ short: 'x', full: 'x' });
const ATTACKED: PendingMessage = {
  type: USER_MESSAGE_TYPE.humanAttacked,
  subject: { kind: 'settler', entity: 7 },
  at: null,
  about: null,
  goodType: null,
  technologies: null,
  jobType: null,
};

describe('seat feeds', () => {
  it('keeps a left seat’s feed, dismissals included, and shows it again on return', () => {
    const feeds = createSeatFeeds(0);
    feeds.current.add(ATTACKED, TICK, TEXT);
    feeds.current.remove(1, true);
    expect(feeds.switchTo(1)).toBe(true);
    expect(feeds.seat).toBe(1);
    expect(feeds.current.live()).toEqual([]);
    // The other seat's note is its own; a repeat there is a fresh note.
    expect(feeds.current.add(ATTACKED, TICK + 1, TEXT)).toBe('accepted');

    feeds.switchTo(0);
    expect(feeds.current.live()).toEqual([]);
    expect(feeds.current.add(ATTACKED, TICK + 2, TEXT)).toBe('duplicate'); // still dismissed here
  });

  it('carries the filter level across switches and shows the whole map a fresh empty feed', () => {
    const feeds = createSeatFeeds(0);
    const raised = feeds.current.cycleLevel();
    feeds.current.add(ATTACKED, TICK, TEXT);
    feeds.switchTo(null);
    expect(feeds.current.level()).toBe(raised);
    expect(feeds.current.live()).toEqual([]);
    feeds.current.add(ATTACKED, TICK + 1, TEXT);
    feeds.switchTo(0);
    expect(feeds.current.live()).toHaveLength(1);
    feeds.switchTo(null);
    expect(feeds.current.live()).toEqual([]); // nothing accrues for the whole map
  });

  it('reports no switch for the seat already shown', () => {
    const feeds = createSeatFeeds(2);
    expect(feeds.switchTo(2)).toBe(false);
    expect(feeds.switchTo(null)).toBe(true);
    expect(feeds.switchTo(null)).toBe(false);
  });
});
