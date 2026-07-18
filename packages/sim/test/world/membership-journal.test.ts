import { describe, expect, it } from 'vitest';
import { defineComponent, World } from '../../src/ecs/world.js';

/**
 * The World membership journal (`journalMembership`/`membershipDeltasSince`) — the replay feed the
 * incremental spatial memos catch up from instead of rebuilding on every store-generation bump.
 * Pinned: entry `i` maps to generation `base + i + 1`, a span the journal cannot cover answers
 * `null` (the rebuild fallback), and the cap drops the oldest span instead of growing forever.
 */

interface Tag {
  n: number;
}

describe('World membership journal', () => {
  it('answers null for an unjournaled component, and replays adds/removes/destroys once journaled', () => {
    const w = new World();
    const C = defineComponent<Tag>('JournalTag');
    expect(w.membershipDeltasSince(C, 0)).toBeNull();

    w.journalMembership(C);
    const before = w.componentGeneration(C);
    const a = w.create();
    const b = w.create();
    w.add(a, C, { n: 1 });
    w.add(b, C, { n: 2 });
    w.remove(a, C);
    w.destroy(b); // deletes b's C row → journaled like an explicit remove
    expect(w.membershipDeltasSince(C, before)).toEqual([a, b, a, b]);
    // A consumer already caught up sees an empty span, not null.
    expect(w.membershipDeltasSince(C, w.componentGeneration(C))).toEqual([]);
  });

  it('journals a value-overwriting re-add (the consumer must re-read the stored value)', () => {
    const w = new World();
    const C = defineComponent<Tag>('JournalOverwrite');
    w.journalMembership(C);
    const a = w.create();
    w.add(a, C, { n: 1 });
    const mid = w.componentGeneration(C);
    w.add(a, C, { n: 2 }); // same membership, new value — still a journaled bump
    expect(w.membershipDeltasSince(C, mid)).toEqual([a]);
  });

  it('drops the oldest span at the cap — a consumer left behind gets null and must rebuild', () => {
    const w = new World();
    const C = defineComponent<Tag>('JournalCap');
    w.journalMembership(C);
    const before = w.componentGeneration(C);
    const e = w.create();
    // Push past the retained window: the journal resets its base instead of growing forever.
    for (let i = 0; i < World.MEMBERSHIP_JOURNAL_LIMIT + 100; i++) w.add(e, C, { n: i });
    expect(w.membershipDeltasSince(C, before)).toBeNull();
    // A consumer inside the retained window still replays.
    const recent = w.componentGeneration(C);
    w.add(e, C, { n: -1 });
    expect(w.membershipDeltasSince(C, recent)).toEqual([e]);
  });
});
