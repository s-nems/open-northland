import { createMessageFeed, type MessageFeed, type MessageFeedState } from './feed.js';

/**
 * The feed shown for the viewer's seat, swapped as a spectator switches seats. A seat's notes start at
 * the first switch to it and its feed is kept as it stood when the viewer left, so a return keeps what
 * was dismissed. The whole map (null) shows a fresh empty feed each time. The filter level is the
 * viewer's, not the seat's, so it carries across every switch. A HUD remount restores the shown feed
 * alone: the left feeds die with the mount, so a return after a scale change starts over.
 */
export interface SeatFeeds {
  readonly current: MessageFeed;
  readonly seat: number | null;
  /** Show `seat`'s feed; false when it is already shown. */
  switchTo(seat: number | null): boolean;
  /** Replace the shown feed outright, the way a HUD remount restores it. */
  restore(state: MessageFeedState): void;
}

export function createSeatFeeds(seat: number | null, initial?: MessageFeedState): SeatFeeds {
  const left = new Map<number, MessageFeedState>();
  let current = createMessageFeed(initial);
  let shown = seat;
  return {
    get current() {
      return current;
    },
    get seat() {
      return shown;
    },
    switchTo(next) {
      if (next === shown) return false;
      if (shown !== null) left.set(shown, current.state());
      const level = current.level();
      current = createMessageFeed(next === null ? undefined : left.get(next));
      current.setLevel(level);
      shown = next;
      return true;
    },
    restore(state) {
      current = createMessageFeed(state);
    },
  };
}
