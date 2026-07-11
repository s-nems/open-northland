import { Age, Health, Settler, needsEnabled } from '../../components/index.js';
import { type Fixed, ONE, fx } from '../../core/fixed.js';
import type { System } from '../context.js';

/**
 * How much a settler's hunger rises each tick, in fixed-point [0,ONE] hunger units.
 *
 * source-basis (approximated — see source basis): the original drives hunger through
 * `atomicanimations.ini` `event <at> 2 <delta>` tuples — an activity animation drains a fixed amount
 * (e.g. `event 30 2 -100`) while an `eat_slot_food` animation restores it (`event 30 2 +4000`), on a
 * large integer scale where one meal ≈ +4000. That event-driven, per-animation model needs the atomic
 * `event (type,value)` vocabulary decoded (a deferred extraction — see historical plan phase-1 risks), so for
 * now hunger rises at a small CONSTANT per-tick rate: this is the basic "hunger grows over time, eating
 * resets it" core, deterministic and bounded, with the event-driven per-activity rates as the faithful
 * target. The rate ONE/4096 per tick fills an empty bar in 4096 ticks — long enough that a settler
 * works several harvest/haul cycles between meals (the original's ~40-activities-per-meal cadence),
 * short enough to exercise the eat path in a headless scenario.
 */
export const HUNGER_RISE_PER_TICK: Fixed = fx.div(ONE, fx.fromInt(4096));

/**
 * How much a settler's fatigue (tiredness) rises each tick, in fixed-point [0,ONE] units.
 *
 * source-basis (approximated — see source basis): like {@link HUNGER_RISE_PER_TICK}, the original
 * drives rest through per-animation `atomicanimations.ini` events — activity ticks fatigue up while a
 * `sleep` animation restores it (`viking_civilist_sleep` carries `event <at> 1 +4000` tuples on the
 * same ~10000-scale bar hunger uses, type 1 being the rest channel as type 2 is hunger). That
 * event-driven model waits on the same atomic `event (type,value)` decode hunger does, so fatigue
 * rises at a CONSTANT per-tick rate for now: the basic "tiredness grows over time, sleeping resets it"
 * core. Set SLOWER than hunger (ONE/8192 ≈ one sleep per two meals) so a settler eats more often than
 * it sleeps, the original's rough cadence; the constant is the recorded faithful-target stand-in.
 */
export const FATIGUE_RISE_PER_TICK: Fixed = fx.div(ONE, fx.fromInt(8192));

/**
 * How much a settler's piety need rises each tick, in fixed-point [0,ONE] units.
 *
 * source-basis (approximated — see source basis): the first **target-bound** non-food need (satisfied
 * by praying *at a temple*, not in place / at a store). Like {@link HUNGER_RISE_PER_TICK} and
 * {@link FATIGUE_RISE_PER_TICK}, the original drives it through per-animation `atomicanimations.ini`
 * events on a numbered channel (type 1 = rest, type 2 = hunger; the religious channel is another id),
 * which needs the atomic `event (type,value)` vocabulary decoded (the same deferred Phase-1
 * extraction). For now piety rises at a CONSTANT per-tick rate: the basic "devotion lapses over time,
 * praying restores it" core. Set SLOWER than fatigue (ONE/16384 ≈ one prayer per two sleeps) — a
 * spiritual need is satisfied far less often than eating or resting, the original's rough cadence; the
 * constant is the recorded faithful-target stand-in. The *reset* (the `pray` atomic id 12) and the
 * *drive* (walk to a temple when piety crosses a threshold) are a later slice — this is the rise half.
 */
export const PIETY_RISE_PER_TICK: Fixed = fx.div(ONE, fx.fromInt(16384));

/**
 * How much a settler's enjoyment (recreation/leisure) need rises each tick, in fixed-point [0,ONE] units.
 *
 * source-basis (approximated — see source basis): the leisure need, satisfied by the `enjoy` atomic
 * (id 17). Like {@link HUNGER_RISE_PER_TICK}/{@link FATIGUE_RISE_PER_TICK}/{@link PIETY_RISE_PER_TICK},
 * the original drives it through per-animation `atomicanimations.ini` events on a numbered channel —
 * `viking_civilist_enjoy` carries `event <at> 3 <delta>` tuples (channel 3 = the enjoy/leisure need, as
 * channel 1 = rest, 2 = hunger; verified across tribes), which needs the atomic `event (type,value)`
 * vocabulary decoded (the same deferred Phase-1 extraction). For now enjoyment rises at a CONSTANT
 * per-tick rate: the basic "leisure lapses over time, having fun restores it" core. Set SLOWER than
 * piety (ONE/32768 ≈ one outing per two prayers) — recreation is the least-pressing of the bars; the
 * constant is the recorded faithful-target stand-in. The *reset* (the `enjoy` atomic id 17) is wired
 * (AtomicSystem); the *drive* (where it is satisfied) is deferred — unlike pray (at a temple), `enjoy`
 * has no readable building satisfier in `houses.ini` to walk to (see source basis). This is the
 * rise half.
 */
export const ENJOYMENT_RISE_PER_TICK: Fixed = fx.div(ONE, fx.fromInt(32768));

/**
 * Starvation cadence: a settler whose hunger is PINNED at `ONE` (fully starving) takes a bite of
 * damage every this-many ticks. Damage lands on a half-second beat (not every tick) so the per-bite
 * amount stays a meaningful integer across wildly different `Health.max` pools (170..20000).
 */
export const STARVATION_DAMAGE_INTERVAL_TICKS = 10;
/**
 * How many starvation bites empty a full `Health` pool: each bite is `max(1, ⌊max/240⌋)`, so death
 * takes 240..479 intervals for a pool ≥ 240 HP (truncation — the default 300-HP pool bites 1 and dies
 * after 300 intervals × 10 ticks = 3000 ticks ≈ 2.5 minutes) and exactly `max` intervals for a smaller
 * pool (the 1-damage floor). APPROXIMATED (user decision 2026-07-11: "starving settlers lose health
 * and die"): the original starves settlers to death, but its rate rides the undecoded per-animation
 * event scale (see {@link HUNGER_RISE_PER_TICK}) — a couple of minutes is our named stand-in, chosen
 * to give a player time to react after the hunger bar empties.
 */
export const STARVATION_BITES_TO_DIE = 240;

/**
 * NeedsSystem — settlers get hungry and tired over time.
 *
 * Each tick every {@link Settler}'s `hunger` rises by {@link HUNGER_RISE_PER_TICK}, `fatigue` by
 * {@link FATIGUE_RISE_PER_TICK}, `piety` by {@link PIETY_RISE_PER_TICK}, and `enjoyment` by
 * {@link ENJOYMENT_RISE_PER_TICK}, each clamped at `ONE` (a fully-spent settler stays pinned at the top
 * of its bar until it acts — the `hungerInRange`/`fatigueInRange`/`pietyInRange`/`enjoymentInRange`
 * invariants require the need ∈ `[0, ONE]`). The complementary side is wired for hunger (the `eat`
 * atomic resets `hunger`), fatigue (the `sleep` atomic, with a sleep *drive*), and piety (the `pray`
 * atomic, with a pray *drive*). Enjoyment is the recreation/leisure need; it has TWO resets that both
 * restore the same channel-3 bar — the `enjoy` atomic (id 17) and `make_love` (id 78, a bigger
 * `event <at> 3 +800` boost; not a separate need) — both wired (AtomicSystem), but their *drive* is
 * deferred: unlike pray (at a temple), neither has a readable building satisfier in `houses.ini` to
 * walk to (see source basis). This system is the needs-rise half; with make_love wired, every named
 * non-food need (sleep/pray/enjoy/make_love) has its atomic reset.
 *
 * **Starvation** is this system's damage half: a settler whose hunger is pinned at `ONE` loses
 * hitpoints on the {@link STARVATION_DAMAGE_INTERVAL_TICKS} beat until the eat drive feeds it or the
 * pool empties (the CleanupSystem then reaps it like any other death). Exempt — because nothing can
 * feed them today, so starving them would only depopulate the map, a named approximation each:
 *  - ANIMALS (`jobType` null): no eat/graze mechanic yet;
 *  - JOBLESS settlers (also `jobType` null — e.g. a worker whose workplace was demolished): the eat
 *    drive lives in the job planner, which skips a jobless settler (`ai.ts` planNeeds);
 *  - BABIES/CHILDREN ({@link Age} carriers, removed at adulthood): the planner skips them too — a
 *    baby is cared for, it doesn't self-feed — and starving them would kill every newborn before its
 *    `GROWUP_TICKS` boundary, turning reproduction into a death loop.
 *
 * The whole system is gated by the {@link needsEnabled} world rule (the `setNeedsEnabled` command):
 * disabled, needs freeze where they are and starvation stops — the dev/admin lever scenes default to.
 *
 * Determinism: no RNG, no wall-clock — each need advances by a fixed Fixed step that divides ONE
 * exactly (no accumulated rounding drift), and starvation bites integer damage on a tick-modulo beat.
 * Settlers are visited in the Settler store's deterministic insertion order; the per-entity update is
 * order-independent (each reads/writes only its own need/health fields), so order can't leak into the
 * result.
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
    // Starvation: only a settler that COULD have fed itself bleeds hitpoints — animals/jobless
    // (jobType null) and babies/children (Age carriers) have no working eat path yet, so they are
    // exempt (see the header). The 0-HP reap (and its settlerDied event) is CleanupSystem's.
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
