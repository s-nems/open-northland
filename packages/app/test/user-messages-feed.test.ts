import { describe, expect, it } from 'vitest';
import { JOB_BUILDER, JOB_COLLECTOR } from '../src/catalog/jobs.js';
import {
  createMessageFeed,
  MESSAGE_LIFETIME_TICKS,
  MESSAGE_SLOTS,
  SIMILAR_MESSAGE_RANGE_CELLS,
} from '../src/hud/tool-panel/messages/feed.js';
import type { MessageText } from '../src/hud/tool-panel/messages/text.js';
import {
  type MessageSubject,
  type PendingMessage,
  USER_MESSAGE_TYPE,
  type UserMessageType,
} from '../src/hud/tool-panel/messages/types.js';

const TICK = 100;
const TEXT = (): MessageText => ({ subject: null, short: 'x', full: 'x' });

function pending(
  type: UserMessageType,
  subject: MessageSubject | null = { kind: 'settler', entity: 7 },
  extra: Partial<PendingMessage> = {},
): PendingMessage {
  return {
    type,
    subject,
    at: null,
    about: null,
    goodType: null,
    technologies: null,
    jobType: null,
    ...extra,
  };
}

describe('message feed', () => {
  it('mutes anything raised while the world is still being assembled', () => {
    const feed = createMessageFeed();
    expect(feed.add(pending(USER_MESSAGE_TYPE.houseFinished), 0, TEXT)).toBe('muted');
    expect(feed.add(pending(USER_MESSAGE_TYPE.houseFinished), 1, TEXT)).toBe('muted');
    expect(feed.add(pending(USER_MESSAGE_TYPE.houseFinished), 2, TEXT)).toBe('accepted');
  });

  it('stamps id, tick and priority on an accepted message', () => {
    const feed = createMessageFeed();
    feed.add(pending(USER_MESSAGE_TYPE.humanDied, null), TICK, TEXT);
    feed.add(pending(USER_MESSAGE_TYPE.wasBorn), TICK + 1, TEXT);
    expect(feed.displayed().map((m) => [m.id, m.tick, m.priority])).toEqual([
      [1, TICK, 2],
      [2, TICK + 1, 0],
    ]);
  });

  it('swallows a repeat of a displayed message and of a dismissed one', () => {
    const feed = createMessageFeed();
    expect(feed.add(pending(USER_MESSAGE_TYPE.humanAttacked), TICK, TEXT)).toBe('accepted');
    expect(feed.add(pending(USER_MESSAGE_TYPE.humanAttacked), TICK + 5, TEXT)).toBe('duplicate');
    expect(feed.remove(1, true)).toBe(true);
    expect(feed.displayed()).toHaveLength(0);
    expect(feed.add(pending(USER_MESSAGE_TYPE.humanAttacked), TICK + 10, TEXT)).toBe('duplicate');
    // A different settler is a different message.
    expect(
      feed.add(pending(USER_MESSAGE_TYPE.humanAttacked, { kind: 'settler', entity: 8 }), TICK + 10, TEXT),
    ).toBe('accepted');
  });

  it('keeps subject-less messages apart by who they are about', () => {
    const feed = createMessageFeed();
    const death = (entity: number): PendingMessage =>
      pending(USER_MESSAGE_TYPE.humanDied, null, { about: entity });
    const lost = (player: number): PendingMessage =>
      pending(USER_MESSAGE_TYPE.playerDied, null, { about: player });
    expect(feed.add(death(11), TICK, TEXT)).toBe('accepted');
    expect(feed.add(death(12), TICK, TEXT)).toBe('accepted');
    expect(feed.add(death(11), TICK + 40, TEXT)).toBe('duplicate');
    expect(feed.add(lost(2), TICK, TEXT)).toBe('accepted');
    expect(feed.add(lost(3), TICK, TEXT)).toBe('accepted');
    expect(feed.add(lost(2), TICK, TEXT)).toBe('duplicate');
    expect(feed.displayed()).toHaveLength(4);
  });

  it('keeps the work and building lists from one experience gain as two messages', () => {
    const feed = createMessageFeed();
    const work = pending(USER_MESSAGE_TYPE.experienceUnlocks, undefined, {
      technologies: [
        { kind: 'job', typeId: 8 },
        { kind: 'good', typeId: 9 },
      ],
    });
    const buildings = pending(USER_MESSAGE_TYPE.experienceUnlocks, undefined, {
      technologies: [
        { kind: 'house', typeId: 10 },
        { kind: 'house', typeId: 11 },
      ],
    });
    expect(feed.add(work, TICK, TEXT)).toBe('accepted');
    expect(feed.add(buildings, TICK, TEXT)).toBe('accepted');
    expect(feed.add(work, TICK + 1, TEXT)).toBe('duplicate');
    expect(feed.displayed()).toHaveLength(2);
  });

  it('keeps every note and every dismissal when told to expire agelessly', () => {
    const feed = createMessageFeed();
    feed.add(pending(USER_MESSAGE_TYPE.humanAttacked), TICK, TEXT);
    feed.add(pending(USER_MESSAGE_TYPE.hungry), TICK, TEXT);
    feed.remove(2, true);
    feed.expire(TICK + 2 * MESSAGE_LIFETIME_TICKS, () => false, true);
    expect(feed.live().map((m) => m.id)).toEqual([1]);
    expect(feed.add(pending(USER_MESSAGE_TYPE.hungry), TICK + 2 * MESSAGE_LIFETIME_TICKS, TEXT)).toBe(
      'duplicate',
    );
    feed.expire(TICK + 2 * MESSAGE_LIFETIME_TICKS, (m) => m.id === 1, true);
    expect(feed.live()).toEqual([]);
  });

  it('forgets a dismissed message after its lifetime, so it can be raised again', () => {
    const feed = createMessageFeed();
    feed.add(pending(USER_MESSAGE_TYPE.humanAttacked), TICK, TEXT);
    feed.remove(1, true);
    feed.expire(TICK + MESSAGE_LIFETIME_TICKS - 1, () => false);
    expect(feed.add(pending(USER_MESSAGE_TYPE.humanAttacked), TICK + MESSAGE_LIFETIME_TICKS - 1, TEXT)).toBe(
      'duplicate',
    );
    feed.expire(TICK + MESSAGE_LIFETIME_TICKS, () => false);
    expect(feed.add(pending(USER_MESSAGE_TYPE.humanAttacked), TICK + MESSAGE_LIFETIME_TICKS, TEXT)).toBe(
      'accepted',
    );
  });

  it('a dismissal without history lets the same message come straight back', () => {
    const feed = createMessageFeed();
    feed.add(pending(USER_MESSAGE_TYPE.humanAttacked), TICK, TEXT);
    feed.remove(1, false);
    expect(feed.add(pending(USER_MESSAGE_TYPE.humanAttacked), TICK + 1, TEXT)).toBe('accepted');
  });

  it('hides the notes below the level but keeps and counts them, whatever the level does next', () => {
    const feed = createMessageFeed();
    feed.add(pending(USER_MESSAGE_TYPE.wasBorn), TICK, TEXT); // routine
    feed.add(pending(USER_MESSAGE_TYPE.houseFinished, { kind: 'building', entity: 3 }), TICK, TEXT); // notable
    feed.add(pending(USER_MESSAGE_TYPE.humanDied, null), TICK, TEXT); // important
    expect(feed.displayed()).toHaveLength(3);
    expect(feed.tally()).toEqual([1, 1, 1]);
    const before = feed.version();
    expect(feed.cycleLevel()).toBe(1);
    expect(feed.version()).toBeGreaterThan(before);
    expect(feed.displayed().map((m) => m.type)).toEqual([
      USER_MESSAGE_TYPE.houseFinished,
      USER_MESSAGE_TYPE.humanDied,
    ]);
    // An arrival under the bar is kept for the tally, not shown.
    expect(feed.add(pending(USER_MESSAGE_TYPE.hungry), TICK + 1, TEXT)).toBe('accepted');
    expect(feed.displayed()).toHaveLength(2);
    expect(feed.live()).toHaveLength(4);
    expect(feed.tally()).toEqual([2, 1, 1]);
    expect(feed.cycleLevel()).toBe(2);
    expect(feed.displayed().map((m) => m.type)).toEqual([USER_MESSAGE_TYPE.humanDied]);
    expect(feed.cycleLevel()).toBe(0);
    expect(feed.displayed()).toHaveLength(4);
  });

  it('applies the collector rule through the pending job', () => {
    const feed = createMessageFeed();
    feed.setLevel(1);
    feed.add(pending(USER_MESSAGE_TYPE.goodNotFound, undefined, { jobType: JOB_BUILDER }), TICK, TEXT);
    feed.add(
      pending(USER_MESSAGE_TYPE.goodNotFound, { kind: 'settler', entity: 8 }, { jobType: JOB_COLLECTOR }),
      TICK,
      TEXT,
    );
    expect(feed.live().map((m) => m.priority)).toEqual([0, 1]);
    expect(feed.displayed().map((m) => m.priority)).toEqual([1]);
  });

  it('rejects arrivals once every slot is taken', () => {
    const feed = createMessageFeed();
    for (let i = 0; i < MESSAGE_SLOTS; i++) {
      expect(feed.add(pending(USER_MESSAGE_TYPE.wasBorn, { kind: 'settler', entity: i }), TICK, TEXT)).toBe(
        'accepted',
      );
    }
    expect(
      feed.add(pending(USER_MESSAGE_TYPE.wasBorn, { kind: 'settler', entity: MESSAGE_SLOTS }), TICK, TEXT),
    ).toBe('full');
  });

  it('retires a note after its lifetime and when its subject is gone', () => {
    const feed = createMessageFeed();
    feed.add(pending(USER_MESSAGE_TYPE.wasBorn, { kind: 'settler', entity: 1 }), TICK, TEXT);
    feed.add(pending(USER_MESSAGE_TYPE.wasBorn, { kind: 'settler', entity: 2 }), TICK + 10, TEXT);
    feed.expire(TICK + 20, (m) => m.subject?.entity === 1);
    expect(feed.displayed().map((m) => m.subject?.entity)).toEqual([2]);
    feed.expire(TICK + 10 + MESSAGE_LIFETIME_TICKS, () => false);
    expect(feed.displayed()).toHaveLength(0);
  });

  it('a standing note outlives the lifetime and ends only when its state is over', () => {
    const feed = createMessageFeed();
    const lost = pending(USER_MESSAGE_TYPE.lostWithoutSignposts);
    feed.add(lost, TICK, TEXT);
    feed.expire(TICK + MESSAGE_LIFETIME_TICKS, () => false);
    expect(feed.displayed()).toHaveLength(1);
    feed.expire(TICK + MESSAGE_LIFETIME_TICKS, (m) => m.type === USER_MESSAGE_TYPE.lostWithoutSignposts);
    expect(feed.displayed()).toHaveLength(0);
    // Dismissed by hand, it keeps its repeat away while the state lasts, and no longer once it is over.
    feed.add(lost, TICK, TEXT);
    feed.remove(2, true);
    feed.expire(TICK + MESSAGE_LIFETIME_TICKS, () => false);
    expect(feed.add(lost, TICK + MESSAGE_LIFETIME_TICKS, TEXT)).toBe('duplicate');
    feed.expire(TICK + MESSAGE_LIFETIME_TICKS, () => true);
    expect(feed.add(lost, TICK + MESSAGE_LIFETIME_TICKS, TEXT)).toBe('accepted');
  });

  it('Shift-dismiss clears the shown notes into history and leaves the ones under the level', () => {
    const feed = createMessageFeed();
    feed.add(pending(USER_MESSAGE_TYPE.wasBorn, { kind: 'settler', entity: 1 }), TICK, TEXT);
    feed.add(pending(USER_MESSAGE_TYPE.wasBorn, { kind: 'settler', entity: 2 }), TICK, TEXT);
    feed.add(pending(USER_MESSAGE_TYPE.humanDied, null), TICK, TEXT);
    feed.setLevel(2);
    feed.removeAll(true);
    expect(feed.displayed()).toHaveLength(0);
    expect(feed.live().map((m) => m.type)).toEqual([USER_MESSAGE_TYPE.wasBorn, USER_MESSAGE_TYPE.wasBorn]);
    expect(feed.state().history).toHaveLength(1);
    feed.setLevel(0);
    feed.removeAll(true);
    expect(feed.live()).toHaveLength(0);
    expect(feed.state().history).toHaveLength(3);
  });

  it('merges neighbouring settlers missing the same good, but not distant ones', () => {
    const feed = createMessageFeed();
    const near = SIMILAR_MESSAGE_RANGE_CELLS - 1;
    const far = SIMILAR_MESSAGE_RANGE_CELLS + 1;
    const missing = (entity: number, hx: number, goodType: number) =>
      pending(USER_MESSAGE_TYPE.goodNotFound, { kind: 'settler', entity }, { at: { hx, hy: 0 }, goodType });
    expect(feed.add(missing(1, 0, 5), TICK, TEXT)).toBe('accepted');
    expect(feed.add(missing(2, near * 2, 5), TICK, TEXT)).toBe('duplicate');
    expect(feed.add(missing(3, far * 2, 5), TICK, TEXT)).toBe('accepted');
    // A different good, or a type outside the rule, is never "similar".
    expect(feed.add(missing(4, 0, 6), TICK, TEXT)).toBe('accepted');
    expect(
      feed.add(
        pending(USER_MESSAGE_TYPE.hungry, { kind: 'settler', entity: 5 }, { at: { hx: 0, hy: 0 } }),
        TICK,
        TEXT,
      ),
    ).toBe('accepted');
  });

  it('composes the text only for an accepted message', () => {
    const feed = createMessageFeed();
    let composed = 0;
    const compose = (): MessageText => {
      composed++;
      return { subject: null, short: 'text', full: 'text' };
    };
    expect(feed.add(pending(USER_MESSAGE_TYPE.humanAttacked), 0, compose)).toBe('muted');
    expect(feed.add(pending(USER_MESSAGE_TYPE.humanAttacked), TICK, compose)).toBe('accepted');
    expect(feed.add(pending(USER_MESSAGE_TYPE.humanAttacked), TICK, compose)).toBe('duplicate');
    expect(composed).toBe(1);
    expect(feed.displayed()[0]?.text.full).toBe('text');
  });

  it('round-trips through its state, keeping the level and the id counter', () => {
    const feed = createMessageFeed();
    feed.setLevel(1);
    feed.add(pending(USER_MESSAGE_TYPE.houseFinished, { kind: 'building', entity: 3 }), TICK, TEXT);
    const restored = createMessageFeed(feed.state());
    expect(restored.level()).toBe(1);
    expect(restored.displayed()).toEqual(feed.displayed());
    restored.add(pending(USER_MESSAGE_TYPE.humanDied, null), TICK + 1, TEXT);
    expect(restored.displayed().map((m) => m.id)).toEqual([1, 2]);
  });
});
