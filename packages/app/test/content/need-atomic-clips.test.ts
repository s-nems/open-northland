import { systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

/**
 * The real-data half of the need-atomic clip resolution. Two rules are pure string/id joins against the
 * served content, so a pipeline change can silently degrade them to a shorter fallback clip instead of
 * failing - these pin them against the actual IR.
 *
 *  - the CIVILIST fallback: `setatomic` binds eat only for jobs 3,4,5,6,31,34 and sleep for 1–6,31, so a
 *    builder/collector/farmer/carrier binds neither and must borrow the civilist clip rather than land on
 *    the 4-tick unresolved stub;
 *  - the data's at-home clips (`<clip>_home`, `<body>_eat_athome`) stay unplayed: no `setatomic` binds
 *    them, so a settler at home plays its usual clips and only the need rules scale what they pay.
 */

const VIKING = 1;
const CIVILIST = 6;
const BUILDER = 7;
const COLLECTOR = 8;
const CARRIER = 24;
const EAT_ATOMIC = 10;
const SLEEP_ATOMIC = 8;
const PICKUP_ATOMIC = 22;
const PILEUP_ATOMIC = 23;

/** The names the data gives its at-home clips. */
const AT_HOME_CLIP = /(_home|_athome)$/;

/** The unresolved-chain default in `readviews/animations.ts` - no real clip may collapse to it. */
const DEFAULT_ATOMIC_DURATION = 4;

describe.runIf(hasRealIr())('need-atomic clips resolve against the served content', () => {
  it('gives every working trade the civilist meal and nap, not the unresolved stub', async () => {
    const { merge } = await loadContentUnderTest();
    const content = merge.content;
    const civilistEat = systems.atomicDuration(content, { tribe: VIKING, jobType: CIVILIST }, EAT_ATOMIC);
    const civilistSleep = systems.atomicDuration(content, { tribe: VIKING, jobType: CIVILIST }, SLEEP_ATOMIC);
    // The civilist's own bindings - the lengths the fallback hands everyone else.
    expect(civilistEat).toBe(50); // viking_civilist_eat_slot_food
    expect(civilistSleep).toBe(237); // viking_civilist_sleep

    for (const jobType of [BUILDER, COLLECTOR, CARRIER]) {
      const settler = { tribe: VIKING, jobType };
      expect(systems.atomicDuration(content, settler, EAT_ATOMIC)).toBe(civilistEat);
      expect(systems.atomicDuration(content, settler, SLEEP_ATOMIC)).toBe(civilistSleep);
      expect(systems.atomicDuration(content, settler, EAT_ATOMIC)).not.toBe(DEFAULT_ATOMIC_DURATION);
    }
  });

  it('gives every working trade the civilist store exchange, which only jobs 1-6 bind themselves', async () => {
    const { merge } = await loadContentUnderTest();
    const content = merge.content;
    for (const jobType of [BUILDER, COLLECTOR, CARRIER])
      for (const atomic of [PICKUP_ATOMIC, PILEUP_ATOMIC])
        expect(systems.atomicDuration(content, { tribe: VIKING, jobType }, atomic)).toBe(20); // viking_civilist_pickup/pileup
  });

  it('binds none of the at-home clips the data authors', async () => {
    const { merge } = await loadContentUnderTest();
    const content = merge.content;
    const authored = content.atomicAnimations.filter((clip) => AT_HOME_CLIP.test(clip.name));
    expect(authored.map((clip) => clip.name)).toContain('viking_civilist_eat_athome');
    const bound = content.tribes.flatMap((tribe) =>
      tribe.atomicBindings.filter((binding) => AT_HOME_CLIP.test(binding.animation)),
    );
    expect(bound).toEqual([]);
  });
});
