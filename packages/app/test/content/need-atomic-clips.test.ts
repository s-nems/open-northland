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
 *  - the at-home twins the indoor rules play instead: the sleep clip's `<clip>_home`, and the meal's own
 *    `<body>_eat_athome` beside the eat slot.
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

  it('carries the at-home sleep twin the rung derives by name, and it is the shorter clip', async () => {
    const { merge } = await loadContentUnderTest();
    const content = merge.content;
    const outdoor = systems.atomicClipName(content, { tribe: VIKING, jobType: CIVILIST }, SLEEP_ATOMIC);
    expect(outdoor).toBe('viking_civilist_sleep');
    // The suffix rule the sleep-at-home rung applies. Same rest for a fifth of the time is the mechanic;
    // if extraction ever drops the twin the rung silently falls back to the 237-tick outdoor clip.
    const atHome = systems.atomicDurationForName(content, `${outdoor}_home`);
    expect(atHome).toBe(50);
    expect(atHome).toBeLessThan(systems.atomicDurationForName(content, outdoor));
  });

  it('carries the at-home meal the indoor chain plays, worth half again the one eaten in the field', async () => {
    const { merge } = await loadContentUnderTest();
    const content = merge.content;
    const civilist = { tribe: VIKING, jobType: CIVILIST };
    const field = systems.atomicClipName(content, civilist, EAT_ATOMIC);
    const atHome = systems.atomicClipNameAtHome(content, civilist, EAT_ATOMIC);
    expect(field).toBe('viking_civilist_eat_slot_food');
    // Not a `_home` suffix: the data names the at-home meal on its own, and the chain pays what it says.
    expect(atHome).toBe('viking_civilist_eat_athome');
    expect(mealUnits(content, atHome)).toBe(6000);
    expect(mealUnits(content, field)).toBe(4000);
  });
});

/** What a named meal clip pays out on the hunger channel. */
function mealUnits(content: Parameters<typeof systems.atomicEventChannelDelta>[0], clip?: string): number {
  return clip === undefined
    ? 0
    : systems.atomicEventChannelDelta(content, clip, systems.ATOMIC_EVENT_CHANNEL.HUNGER);
}
