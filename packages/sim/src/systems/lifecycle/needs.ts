import { Age, Health, needsEnabled, Settler } from '../../components/index.js';
import { type Fixed, fx, ONE } from '../../core/fixed.js';
import type { System } from '../context.js';

// Need rise rates, in fixed-point [0,ONE] units per tick.
//
// source-basis (approximated): the original drives needs through per-animation `atomicanimations.ini`
// `event <at> <channel> <delta>` tuples — an activity drains a channel (e.g. `event 30 2 -100`) while a
// satisfying animation restores it (`eat_slot_food`: `event 30 2 +4000`) — on a large integer scale where one
// meal ≈ +4000. Channels: 1 = rest, 2 = hunger, 3 = leisure. That vocabulary is not yet decoded, so each need
// instead rises at a constant per-tick rate: the "need grows over time, acting resets it" core, with the
// event-driven per-activity rates as the faithful target. Each need is set half as fast as the previous, the
// original's rough cadence.

/** Fills an empty bar in 4096 ticks — several harvest/haul cycles between meals (the original's roughly
 * 40-activities-per-meal), short enough to exercise the eat path in a headless scenario. */
export const HUNGER_RISE_PER_TICK: Fixed = fx.div(ONE, fx.fromInt(4096));

/** ≈ one sleep per two meals, so a settler eats more often than it sleeps. Restored by the `sleep`
 * animation (`viking_civilist_sleep` carries `event <at> 1 +4000`). */
export const FATIGUE_RISE_PER_TICK: Fixed = fx.div(ONE, fx.fromInt(8192));

/** ≈ one prayer per two sleeps — a spiritual need is satisfied far less often than eating or resting. The
 * first target-bound need (praying happens *at a temple*, not in place); its channel id is undecoded. The
 * reset (`pray`, atomic 12) and the walk-to-temple drive are a later slice, so this is the rise half. */
export const PIETY_RISE_PER_TICK: Fixed = fx.div(ONE, fx.fromInt(16384));

/** ≈ one outing per two prayers — recreation is the least-pressing bar. Its channel-3 resets are wired
 * (AtomicSystem), but the drive is deferred: unlike pray, `enjoy` has no readable building satisfier in
 * `houses.ini` to walk to. */
export const ENJOYMENT_RISE_PER_TICK: Fixed = fx.div(ONE, fx.fromInt(32768));

/**
 * Starvation cadence: a settler whose hunger is pinned at `ONE` takes a bite of damage every this-many
 * ticks. Damage lands on a half-second beat rather than every tick so the per-bite amount stays a
 * meaningful integer across wildly different `Health.max` pools (170..20000).
 */
export const STARVATION_DAMAGE_INTERVAL_TICKS = 10;
/**
 * How many starvation bites empty a full `Health` pool: each bite is `max(1, ⌊max/240⌋)`, so death takes
 * 240..479 intervals for a pool ≥ 240 HP (truncation — the default 300-HP pool bites 1 and dies after 300
 * intervals × 10 ticks = 3000 ticks ≈ 2.5 minutes) and exactly `max` intervals for a smaller pool (the
 * 1-damage floor).
 *
 * source-basis (approximated): the original starves settlers to death, but its rate rides the undecoded
 * per-animation event scale (see {@link HUNGER_RISE_PER_TICK}); a couple of minutes is the stand-in, chosen
 * to give a player time to react after the hunger bar empties.
 */
export const STARVATION_BITES_TO_DIE = 240;

/**
 * NeedsSystem — the rise half of settler needs, plus starvation damage.
 *
 * Each tick every {@link Settler}'s `hunger`, `fatigue`, `piety`, and `enjoyment` rise by their rate above,
 * each clamped at `ONE` (a fully-spent settler stays pinned at the top of its bar until it acts — the
 * `hungerInRange`/`fatigueInRange`/`pietyInRange`/`enjoymentInRange` invariants require the need ∈ [0, ONE]).
 * Every named non-food need has its atomic reset wired (sleep/pray/enjoy/make_love); only the eat, sleep, and
 * pray *drives* exist so far.
 *
 * Starvation: a settler whose hunger is pinned at `ONE` loses hitpoints on the
 * {@link STARVATION_DAMAGE_INTERVAL_TICKS} beat until the eat drive feeds it or the pool empties (the
 * CleanupSystem then reaps it like any other death). Exempt, because nothing can feed them today and
 * starving them would only depopulate the map — a named approximation each:
 *  - ANIMALS (`jobType` null): no eat/graze mechanic yet;
 *  - JOBLESS settlers (also `jobType` null — e.g. a worker whose workplace was demolished): the eat drive
 *    lives in the job planner, which skips a jobless settler (`ai.ts` planNeeds);
 *  - BABIES/CHILDREN ({@link Age} carriers): the planner skips them too — a baby is cared for, it doesn't
 *    self-feed — and starving them would kill every newborn before its `GROWUP_TICKS` boundary, turning
 *    reproduction into a death loop.
 *
 * The whole system is gated by the {@link needsEnabled} world rule (the `setNeedsEnabled` command):
 * disabled, needs freeze where they are and starvation stops — the dev/admin lever scenes default to.
 */
export const needsSystem: System = (world, ctx) => {
  if (!needsEnabled(world)) return;
  const starvationBeat = ctx.tick % STARVATION_DAMAGE_INTERVAL_TICKS === 0;
  for (const e of world.query(Settler)) {
    const settler = world.get(e, Settler);
    const risenHunger = fx.add(settler.hunger, HUNGER_RISE_PER_TICK);
    settler.hunger = risenHunger > ONE ? ONE : risenHunger;
    const risenFatigue = fx.add(settler.fatigue, FATIGUE_RISE_PER_TICK);
    settler.fatigue = risenFatigue > ONE ? ONE : risenFatigue;
    const risenPiety = fx.add(settler.piety, PIETY_RISE_PER_TICK);
    settler.piety = risenPiety > ONE ? ONE : risenPiety;
    const risenEnjoyment = fx.add(settler.enjoyment, ENJOYMENT_RISE_PER_TICK);
    settler.enjoyment = risenEnjoyment > ONE ? ONE : risenEnjoyment;
    // Only a settler that COULD have fed itself bleeds hitpoints (see the header for the exemptions).
    // The 0-HP reap (and its settlerDied event) is CleanupSystem's.
    if (
      starvationBeat &&
      settler.hunger === ONE &&
      settler.jobType !== null &&
      !world.has(e, Age) &&
      world.has(e, Health)
    ) {
      const health = world.get(e, Health);
      const bite = Math.max(1, Math.trunc(health.max / STARVATION_BITES_TO_DIE));
      health.hitpoints = Math.max(0, health.hitpoints - bite);
    }
  }
};
