import { type ContentSet, IR_VERSION, parseContentSet } from '@vinland/data';
import { describe, expect, it } from 'vitest';
import {
  ATOMIC_EVENT_CHANNEL,
  atomicAnimationByName,
  atomicEventChannelDelta,
  atomicStartDirection,
  isInterruptibleAtomic,
} from '../src/systems/index.js';

/**
 * The atomic-animation read views — `atomicAnimationByName` (the canonical name→record resolver the
 * `atomicDuration`/combat-cadence lookups spell out inline), `isInterruptibleAtomic`,
 * `atomicStartDirection` (the two `atomicanimations.ini` scalars no sim system reads yet), and
 * `atomicEventChannelDelta` (the net per-channel delta over the `events` array — the last extracted
 * `AtomicAnimation` field without a read view). These are genuinely extracted (245/896 animations carry
 * `interruptible=true`, 89/896 a `startDirection`, 695/896 ≥1 `event` in the real IR), so the fixture
 * sets non-default values on a couple of entries to exercise a real read, not just the schema defaults.
 *
 * The fixture mirrors the real shape: an uninterruptible directional swing (`chop`, facing pinned), an
 * interruptible idle (no facing), a plain entry that pins neither (the schema defaults), and an
 * `eat`/`sleep` carrying real-shaped channel `event`s (hunger restore on channel 2, multi-tick rest
 * restore on channel 1, plus a value-less cue event that must contribute 0).
 */
function animationContent(): ContentSet {
  return parseContentSet({
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [{ typeId: 0, id: 'idle' }],
    buildings: [{ typeId: 1, id: 'headquarters', kind: 'headquarters' }],
    atomicAnimations: [
      // A harvest swing: must play to completion (uninterruptible) and pins a facing direction.
      { id: 'viking_chop', name: 'viking_chop', length: 3, interruptible: false, startDirection: 2 },
      // An idle: a settler may abandon it the instant a higher-priority drive fires; no pinned facing.
      { id: 'viking_idle', name: 'viking_idle', length: 100, interruptible: true },
      // A plain entry pinning neither — exercises the schema defaults (interruptible=false, no facing).
      { id: 'viking_walk', name: 'viking_walk', length: 8 },
      // An eat: one hunger-channel (2) restore, plus a value-less cue event that must sum as 0.
      {
        id: 'viking_eat',
        name: 'viking_eat',
        length: 40,
        events: [
          { at: 30, type: ATOMIC_EVENT_CHANNEL.HUNGER, value: 4000 },
          { at: 35, type: 34 }, // a cue (no value) — contributes 0, doesn't throw or skew the sum
        ],
      },
      // A sleep: multiple rest-channel (1) ticks that must sum (mirrors the real per-tick +100 stream).
      {
        id: 'viking_sleep',
        name: 'viking_sleep',
        length: 100,
        events: [
          { at: 20, type: ATOMIC_EVENT_CHANNEL.REST, value: 100 },
          { at: 40, type: ATOMIC_EVENT_CHANNEL.REST, value: 100 },
          { at: 60, type: ATOMIC_EVENT_CHANNEL.REST, value: 100 },
        ],
      },
    ],
  });
}

describe('atomicAnimationByName', () => {
  it('resolves an animation by its exact name (the setatomic join key, not the slug id)', () => {
    const content = animationContent();
    const chop = atomicAnimationByName(content, 'viking_chop');
    expect(chop?.length).toBe(3);
    expect(chop?.name).toBe('viking_chop');
  });

  it('returns undefined for a name with no record (an unresolvable binding is expected, not malformed)', () => {
    expect(atomicAnimationByName(animationContent(), 'nonexistent_anim')).toBeUndefined();
  });

  it('is byte-stable call-to-call (a pure function of content)', () => {
    const content = animationContent();
    expect(atomicAnimationByName(content, 'viking_idle')).toEqual(
      atomicAnimationByName(content, 'viking_idle'),
    );
  });
});

describe('isInterruptibleAtomic', () => {
  it('is true for an interruptible animation and false for an uninterruptible one', () => {
    const content = animationContent();
    expect(isInterruptibleAtomic(content, 'viking_idle')).toBe(true);
    expect(isInterruptibleAtomic(content, 'viking_chop')).toBe(false);
  });

  it('defaults to false for the entry pinning no flag and for an unknown name', () => {
    const content = animationContent();
    expect(isInterruptibleAtomic(content, 'viking_walk')).toBe(false); // schema default
    expect(isInterruptibleAtomic(content, 'nonexistent_anim')).toBe(false); // unknown → safe non-preempt default
  });
});

describe('atomicStartDirection', () => {
  it('returns the pinned facing index when the animation carries one', () => {
    expect(atomicStartDirection(animationContent(), 'viking_chop')).toBe(2);
  });

  it('returns undefined when the animation pins no facing (distinct from facing 0/north)', () => {
    const content = animationContent();
    expect(atomicStartDirection(content, 'viking_idle')).toBeUndefined();
    expect(atomicStartDirection(content, 'viking_walk')).toBeUndefined();
  });

  it('returns undefined for an unknown name', () => {
    expect(atomicStartDirection(animationContent(), 'nonexistent_anim')).toBeUndefined();
  });
});

describe('atomicEventChannelDelta', () => {
  it('returns the single restore on a channel the animation touches once', () => {
    const content = animationContent();
    expect(atomicEventChannelDelta(content, 'viking_eat', ATOMIC_EVENT_CHANNEL.HUNGER)).toBe(4000);
  });

  it('SUMS repeated ticks on one channel (the per-tick sleep/enjoy stream)', () => {
    const content = animationContent();
    // 3 rest ticks of +100 each → +300
    expect(atomicEventChannelDelta(content, 'viking_sleep', ATOMIC_EVENT_CHANNEL.REST)).toBe(300);
  });

  it('ignores events on other channels (an eat contributes nothing to the rest bar)', () => {
    const content = animationContent();
    expect(atomicEventChannelDelta(content, 'viking_eat', ATOMIC_EVENT_CHANNEL.REST)).toBe(0);
    expect(atomicEventChannelDelta(content, 'viking_sleep', ATOMIC_EVENT_CHANNEL.HUNGER)).toBe(0);
  });

  it('treats a value-less cue event as a 0 delta (does not throw or skew the sum)', () => {
    const content = animationContent();
    // viking_eat carries a `type 34` cue with no `value` alongside the hunger restore; channel 34 sums 0.
    expect(atomicEventChannelDelta(content, 'viking_eat', 34)).toBe(0);
    // …and that cue did not corrupt the hunger total above.
    expect(atomicEventChannelDelta(content, 'viking_eat', ATOMIC_EVENT_CHANNEL.HUNGER)).toBe(4000);
  });

  it('returns 0 for an animation with no events and for an unknown name', () => {
    const content = animationContent();
    expect(atomicEventChannelDelta(content, 'viking_walk', ATOMIC_EVENT_CHANNEL.HUNGER)).toBe(0); // no events
    expect(atomicEventChannelDelta(content, 'nonexistent_anim', ATOMIC_EVENT_CHANNEL.HUNGER)).toBe(0); // unknown
  });

  it('is byte-stable call-to-call (a pure fold over content)', () => {
    const content = animationContent();
    expect(atomicEventChannelDelta(content, 'viking_sleep', ATOMIC_EVENT_CHANNEL.REST)).toBe(
      atomicEventChannelDelta(content, 'viking_sleep', ATOMIC_EVENT_CHANNEL.REST),
    );
  });
});
