import { systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

/**
 * The real-data half of the need-atomic clip resolution. Two rules are pure string/id joins against the
 * served content, so a pipeline change can silently degrade them to a shorter fallback clip instead of
 * failing — these pin them against the actual IR.
 *
 *  - the CIVILIST fallback: `setatomic` binds eat only for jobs 3,4,5,6,31,34 and sleep for 1–6,31, so a
 *    builder/collector/farmer/carrier binds neither and must borrow the civilist clip rather than land on
 *    the 4-tick unresolved stub;
 *  - the `<clip>_home` suffix the at-home sleep rung derives its short indoor clip from.
 */

const VIKING = 1;
const CIVILIST = 6;
const BUILDER = 7;
const COLLECTOR = 8;
const CARRIER = 24;
const EAT_ATOMIC = 10;
const SLEEP_ATOMIC = 8;

/** The unresolved-chain default in `readviews/animations.ts` — no real clip may collapse to it. */
const DEFAULT_ATOMIC_DURATION = 4;

describe.runIf(hasRealIr())('need-atomic clips resolve against the served content', () => {
  it('gives every working trade the civilist meal and nap, not the unresolved stub', async () => {
    const { merge } = await loadContentUnderTest();
    const content = merge.content;
    const civilistEat = systems.needAtomicDuration(content, { tribe: VIKING, jobType: CIVILIST }, EAT_ATOMIC);
    const civilistSleep = systems.needAtomicDuration(
      content,
      { tribe: VIKING, jobType: CIVILIST },
      SLEEP_ATOMIC,
    );
    // The civilist's own bindings — the lengths the fallback hands everyone else.
    expect(civilistEat).toBe(50); // viking_civilist_eat_slot_food
    expect(civilistSleep).toBe(237); // viking_civilist_sleep

    for (const jobType of [BUILDER, COLLECTOR, CARRIER]) {
      const settler = { tribe: VIKING, jobType };
      expect(systems.needAtomicDuration(content, settler, EAT_ATOMIC)).toBe(civilistEat);
      expect(systems.needAtomicDuration(content, settler, SLEEP_ATOMIC)).toBe(civilistSleep);
      expect(systems.needAtomicDuration(content, settler, EAT_ATOMIC)).not.toBe(DEFAULT_ATOMIC_DURATION);
    }
  });

  it('carries the at-home sleep twin the rung derives by name, and it is the shorter clip', async () => {
    const { merge } = await loadContentUnderTest();
    const content = merge.content;
    const outdoor = systems.needAtomicAnimationName(
      content,
      { tribe: VIKING, jobType: CIVILIST },
      SLEEP_ATOMIC,
    );
    expect(outdoor).toBe('viking_civilist_sleep');
    // The suffix rule the sleep-at-home rung applies. Same rest for a fifth of the time is the mechanic;
    // if extraction ever drops the twin the rung silently falls back to the 237-tick outdoor clip.
    const atHome = systems.atomicDurationForName(content, `${outdoor}_home`);
    expect(atHome).toBe(50);
    expect(atHome).toBeLessThan(systems.atomicDurationForName(content, outdoor));
  });
});
