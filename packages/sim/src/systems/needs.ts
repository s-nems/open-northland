import { Settler } from '../components/index.js';
import { type Fixed, ONE, fx } from '../core/fixed.js';
import type { System } from './context.js';

/**
 * How much a settler's hunger rises each tick, in fixed-point [0,ONE] hunger units.
 *
 * FIDELITY (approximated — see docs/FIDELITY.md): the original drives hunger through
 * `atomicanimations.ini` `event <at> 2 <delta>` tuples — an activity animation drains a fixed amount
 * (e.g. `event 30 2 -100`) while an `eat_slot_food` animation restores it (`event 30 2 +4000`), on a
 * large integer scale where one meal ≈ +4000. That event-driven, per-animation model needs the atomic
 * `event (type,value)` vocabulary decoded (a deferred extraction — see ROADMAP Phase-1 risks), so for
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
 * FIDELITY (approximated — see docs/FIDELITY.md): like {@link HUNGER_RISE_PER_TICK}, the original
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
 * FIDELITY (approximated — see docs/FIDELITY.md): the first **target-bound** non-food need (satisfied
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
 * FIDELITY (approximated — see docs/FIDELITY.md): the leisure need, satisfied by the `enjoy` atomic
 * (id 17). Like {@link HUNGER_RISE_PER_TICK}/{@link FATIGUE_RISE_PER_TICK}/{@link PIETY_RISE_PER_TICK},
 * the original drives it through per-animation `atomicanimations.ini` events on a numbered channel —
 * `viking_civilist_enjoy` carries `event <at> 3 <delta>` tuples (channel 3 = the enjoy/leisure need, as
 * channel 1 = rest, 2 = hunger; verified across tribes), which needs the atomic `event (type,value)`
 * vocabulary decoded (the same deferred Phase-1 extraction). For now enjoyment rises at a CONSTANT
 * per-tick rate: the basic "leisure lapses over time, having fun restores it" core. Set SLOWER than
 * piety (ONE/32768 ≈ one outing per two prayers) — recreation is the least-pressing of the bars; the
 * constant is the recorded faithful-target stand-in. The *reset* (the `enjoy` atomic id 17) is wired
 * (AtomicSystem); the *drive* (where it is satisfied) is deferred — unlike pray (at a temple), `enjoy`
 * has no readable building satisfier in `houses.ini` to walk to (see docs/FIDELITY.md). This is the
 * rise half.
 */
export const ENJOYMENT_RISE_PER_TICK: Fixed = fx.div(ONE, fx.fromInt(32768));

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
 * walk to (see docs/FIDELITY.md). This system is the needs-rise half; with make_love wired, every named
 * non-food need (sleep/pray/enjoy/make_love) has its atomic reset.
 *
 * Determinism: no RNG, no wall-clock — each need advances by a fixed Fixed step that divides ONE
 * exactly (no accumulated rounding drift), so identical inputs yield byte-identical state. Settlers
 * are visited in the Settler store's deterministic insertion order; the per-entity update is
 * order-independent (each reads/writes only its own need fields), so order can't leak into the result.
 */
export const needsSystem: System = (world) => {
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
  }
};
