import { describe, expect, it } from 'vitest';
import {
  createMessageFeed,
  DISMISSED_EVENT_BLOCK_TICKS,
  MESSAGE_LIFETIME_TICKS,
  MESSAGE_SLOTS,
} from '../src/hud/tool-panel/messages/feed.js';
import { SNAPSHOT_SWEEP_INTERVAL_TICKS } from '../src/hud/tool-panel/messages/from-snapshot.js';
import type { MessageText } from '../src/hud/tool-panel/messages/text.js';
import {
  type MessageSubject,
  type PendingMessage,
  USER_MESSAGE_TYPE,
  type UserMessageType,
} from '../src/hud/tool-panel/messages/types.js';

const TICK = 100;
const TEXT = (): MessageText => ({ short: 'x', full: 'x' });

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
    feed.add(pending(USER_MESSAGE_TYPE.tired), TICK + 1, TEXT);
    expect(feed.displayed().map((m) => [m.id, m.tick, m.priority])).toEqual([
      [1, TICK, 2],
      [2, TICK + 1, 0],
    ]);
  });

  it('swallows a repeat of a displayed message and of a dismissed one', () => {
    const feed = createMessageFeed();
    expect(feed.add(pending(USER_MESSAGE_TYPE.grewUp), TICK, TEXT)).toBe('accepted');
    expect(feed.add(pending(USER_MESSAGE_TYPE.grewUp), TICK + 5, TEXT)).toBe('duplicate');
    expect(feed.remove(1, TICK + 5)).toBe(true);
    expect(feed.displayed()).toHaveLength(0);
    expect(feed.add(pending(USER_MESSAGE_TYPE.grewUp), TICK + 10, TEXT)).toBe('duplicate');
    // A different settler is a different message.
    expect(feed.add(pending(USER_MESSAGE_TYPE.grewUp, { kind: 'settler', entity: 8 }), TICK + 10, TEXT)).toBe(
      'accepted',
    );
  });

  it('tells a family note with a new reason from the dismissed one', () => {
    const feed = createMessageFeed();
    const family = (familyWait: 'husbandAway' | 'noFood'): PendingMessage =>
      pending(USER_MESSAGE_TYPE.familyBlocked, undefined, { familyWait });
    expect(feed.add(family('husbandAway'), TICK, TEXT)).toBe('accepted');
    expect(feed.remove(1, TICK)).toBe(true);
    expect(feed.add(family('husbandAway'), TICK + 5, TEXT)).toBe('duplicate');
    expect(feed.add(family('noFood'), TICK + 5, TEXT)).toBe('accepted');
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
    feed.add(pending(USER_MESSAGE_TYPE.grewUp), TICK, TEXT);
    feed.add(pending(USER_MESSAGE_TYPE.hungry), TICK, TEXT);
    feed.remove(2, TICK);
    feed.expire(TICK + 2 * MESSAGE_LIFETIME_TICKS, () => false, true);
    expect(feed.live().map((m) => m.id)).toEqual([1]);
    expect(feed.add(pending(USER_MESSAGE_TYPE.hungry), TICK + 2 * MESSAGE_LIFETIME_TICKS, TEXT)).toBe(
      'duplicate',
    );
    feed.expire(TICK + 2 * MESSAGE_LIFETIME_TICKS, (m) => m.id === 1, true);
    expect(feed.live()).toEqual([]);
  });

  it('blocks a dismissed event for the block counted from the dismissal, not from the raise', () => {
    const feed = createMessageFeed();
    const attacked = pending(USER_MESSAGE_TYPE.grewUp);
    const dismissed = TICK + MESSAGE_LIFETIME_TICKS - 10;
    feed.add(attacked, TICK, TEXT);
    feed.remove(1, dismissed);
    // Past the raise's lifetime the repeat stays away.
    feed.expire(TICK + MESSAGE_LIFETIME_TICKS + 10, () => false);
    expect(feed.add(attacked, TICK + MESSAGE_LIFETIME_TICKS + 10, TEXT)).toBe('duplicate');
    const released = dismissed + DISMISSED_EVENT_BLOCK_TICKS;
    feed.expire(released - 1, () => false);
    expect(feed.add(attacked, released - 1, TEXT)).toBe('duplicate');
    feed.expire(released, () => false);
    expect(feed.add(attacked, released, TEXT)).toBe('accepted');
  });

  it('lifts an event dismissal early once its reason is over', () => {
    const feed = createMessageFeed();
    feed.add(pending(USER_MESSAGE_TYPE.vehicleNoPath, { kind: 'vehicle', entity: 4 }), TICK, TEXT);
    feed.remove(1, TICK);
    feed.expire(TICK + 1, () => true);
    expect(
      feed.add(pending(USER_MESSAGE_TYPE.vehicleNoPath, { kind: 'vehicle', entity: 4 }), TICK + 1, TEXT),
    ).toBe('accepted');
  });

  it('hides the notes below the level but keeps and counts them, whatever the level does next', () => {
    const feed = createMessageFeed();
    feed.add(pending(USER_MESSAGE_TYPE.tired), TICK, TEXT); // routine
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

  it('rejects arrivals once every slot is taken', () => {
    const feed = createMessageFeed();
    for (let i = 0; i < MESSAGE_SLOTS; i++) {
      expect(feed.add(pending(USER_MESSAGE_TYPE.tired, { kind: 'settler', entity: i }), TICK, TEXT)).toBe(
        'accepted',
      );
    }
    expect(
      feed.add(pending(USER_MESSAGE_TYPE.tired, { kind: 'settler', entity: MESSAGE_SLOTS }), TICK, TEXT),
    ).toBe('full');
  });

  it('retires an event note after its lifetime and when its subject is gone', () => {
    const feed = createMessageFeed();
    feed.add(pending(USER_MESSAGE_TYPE.grewUp, { kind: 'settler', entity: 1 }), TICK, TEXT);
    feed.add(pending(USER_MESSAGE_TYPE.grewUp, { kind: 'settler', entity: 2 }), TICK + 10, TEXT);
    feed.expire(TICK + 20, (m) => m.subject?.entity === 1);
    expect(feed.displayed().map((m) => m.subject?.entity)).toEqual([2]);
    feed.expire(TICK + 10 + MESSAGE_LIFETIME_TICKS, () => false);
    expect(feed.displayed()).toHaveLength(0);
  });

  it.each([
    ['lost', USER_MESSAGE_TYPE.lostWithoutSignposts],
    ['hungry', USER_MESSAGE_TYPE.hungry],
    ['tired', USER_MESSAGE_TYPE.tired],
    ['nothing to do', USER_MESSAGE_TYPE.nothingToDo],
    ['no commander', USER_MESSAGE_TYPE.vehicleNoCommander],
  ])('keeps one %s card through a state that outlasts the lifetime, with no re-raise', (_, type) => {
    const feed = createMessageFeed();
    const end = TICK + 2 * MESSAGE_LIFETIME_TICKS;
    // The sweep raises the state once a second while it lasts.
    for (let tick = TICK; tick <= end; tick += SNAPSHOT_SWEEP_INTERVAL_TICKS) {
      feed.add(pending(type), tick, TEXT);
      feed.expire(tick, () => false);
    }
    expect(feed.live().map((m) => [m.id, m.tick])).toEqual([[1, TICK]]);
    feed.expire(end, () => true);
    expect(feed.live()).toEqual([]);
  });

  it('holds a dismissed state note while its state lasts, and lets it back once the state ended and recurs', () => {
    const feed = createMessageFeed();
    const hungry = pending(USER_MESSAGE_TYPE.hungry);
    feed.add(hungry, TICK, TEXT);
    feed.remove(1, TICK + 1);
    const late = TICK + 3 * MESSAGE_LIFETIME_TICKS;
    feed.expire(late, () => false);
    expect(feed.add(hungry, late, TEXT)).toBe('duplicate');
    // The settler ate: the sweep sees the state clear, and the next hunger is a new card.
    feed.expire(late + 1, () => true);
    expect(feed.add(hungry, late + 2, TEXT)).toBe('accepted');
  });

  it('keeps one state card per settler whatever trade it holds meanwhile', () => {
    const feed = createMessageFeed();
    expect(feed.add(pending(USER_MESSAGE_TYPE.tired, undefined, { jobType: 7 }), TICK, TEXT)).toBe(
      'accepted',
    );
    expect(feed.add(pending(USER_MESSAGE_TYPE.tired, undefined, { jobType: 8 }), TICK + 1, TEXT)).toBe(
      'duplicate',
    );
  });

  describe('hunger chain', () => {
    const stage = (type: UserMessageType, entity = 7): PendingMessage =>
      pending(type, { kind: 'settler', entity });
    const shown = (feed: ReturnType<typeof createMessageFeed>): UserMessageType[] =>
      feed.live().map((m) => m.type);
    const { hungry, starving, willDie, tired } = USER_MESSAGE_TYPE;

    it('shows one settler only its heaviest stage, each heavier one taking the lighter card’s place', () => {
      const feed = createMessageFeed();
      feed.add(stage(hungry), TICK, TEXT);
      feed.add(stage(tired), TICK, TEXT);
      expect(feed.add(stage(starving), TICK + 1, TEXT)).toBe('accepted');
      expect(shown(feed)).toEqual([tired, starving]);
      expect(feed.add(stage(hungry), TICK + 2, TEXT)).toBe('superseded');
      expect(feed.add(stage(willDie), TICK + 3, TEXT)).toBe('accepted');
      expect(shown(feed)).toEqual([tired, willDie]);
      expect(feed.add(stage(starving), TICK + 4, TEXT)).toBe('superseded');
      // Another settler's chain is its own.
      expect(feed.add(stage(hungry, 8), TICK + 4, TEXT)).toBe('accepted');
    });

    it('shows the lighter stage again once the heavier one passes', () => {
      const feed = createMessageFeed();
      feed.add(stage(starving), TICK, TEXT);
      feed.add(stage(willDie), TICK + 1, TEXT);
      feed.expire(TICK + 2, (m) => m.type === willDie);
      expect(feed.add(stage(starving), TICK + 3, TEXT)).toBe('accepted');
      expect(shown(feed)).toEqual([starving]);
    });

    it('keeps a dismissed lighter stage away after the heavier one passes', () => {
      const feed = createMessageFeed();
      feed.add(stage(hungry), TICK, TEXT);
      feed.remove(1, TICK);
      expect(feed.add(stage(starving), TICK + 1, TEXT)).toBe('accepted');
      feed.expire(TICK + 2, (m) => m.type === starving);
      expect(feed.add(stage(hungry), TICK + 3, TEXT)).toBe('duplicate');
      expect(feed.live()).toEqual([]);
    });

    it('silences the lighter stages under a dismissed heavier card until that stage passes', () => {
      const feed = createMessageFeed();
      feed.add(stage(willDie), TICK, TEXT);
      feed.remove(1, TICK);
      feed.expire(TICK + MESSAGE_LIFETIME_TICKS * 2, () => false);
      expect(feed.add(stage(starving), TICK + MESSAGE_LIFETIME_TICKS * 2, TEXT)).toBe('superseded');
      feed.expire(TICK + MESSAGE_LIFETIME_TICKS * 2 + 1, (m) => m.type === willDie);
      expect(feed.add(stage(starving), TICK + MESSAGE_LIFETIME_TICKS * 2 + 2, TEXT)).toBe('accepted');
    });
  });

  it('Shift-dismiss clears the shown notes into history and leaves the ones under the level', () => {
    const feed = createMessageFeed();
    feed.add(pending(USER_MESSAGE_TYPE.tired, { kind: 'settler', entity: 1 }), TICK, TEXT);
    feed.add(pending(USER_MESSAGE_TYPE.tired, { kind: 'settler', entity: 2 }), TICK, TEXT);
    feed.add(pending(USER_MESSAGE_TYPE.humanDied, null), TICK, TEXT);
    feed.setLevel(2);
    feed.removeAll(TICK);
    expect(feed.displayed()).toHaveLength(0);
    expect(feed.live().map((m) => m.type)).toEqual([USER_MESSAGE_TYPE.tired, USER_MESSAGE_TYPE.tired]);
    expect(feed.state().history).toHaveLength(1);
    feed.setLevel(0);
    feed.removeAll(TICK);
    expect(feed.live()).toHaveLength(0);
    expect(feed.state().history).toHaveLength(3);
  });

  it('composes the text only for an accepted message', () => {
    const feed = createMessageFeed();
    let composed = 0;
    const compose = (): MessageText => {
      composed++;
      return { short: 'text', full: 'text' };
    };
    expect(feed.add(pending(USER_MESSAGE_TYPE.grewUp), 0, compose)).toBe('muted');
    expect(feed.add(pending(USER_MESSAGE_TYPE.grewUp), TICK, compose)).toBe('accepted');
    expect(feed.add(pending(USER_MESSAGE_TYPE.grewUp), TICK, compose)).toBe('duplicate');
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
