import { Settler } from '../components/index.js';
import { type Fixed, ONE, fx } from '../fixed.js';
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
 * NeedsSystem — settlers get hungry over time.
 *
 * Each tick every {@link Settler}'s `hunger` rises by {@link HUNGER_RISE_PER_TICK}, clamped at `ONE`
 * (a fully-hungry settler stays pinned at the top of the bar until it eats — the `hungerInRange`
 * invariant requires `hunger ∈ [0, ONE]`). The complementary side is already wired: the `eat` atomic
 * resets `hunger` to 0 (AtomicSystem), so this system + that effect form the rise/reset loop. What is
 * NOT here yet is the *drive* to eat — the AI planner choosing an `eat` atomic when hunger crosses a
 * threshold (the next slice) — and the non-food needs (`pray`/`enjoy`/social/`make_love`, named but
 * deferred). This is the hunger-rise half only.
 *
 * Determinism: no RNG, no wall-clock — `hunger` advances by a fixed Fixed step that divides ONE
 * exactly (no accumulated rounding drift), so identical inputs yield byte-identical state. Settlers
 * are visited in the Settler store's deterministic insertion order; the per-entity update is
 * order-independent (each reads/writes only its own `hunger`), so order can't leak into the result.
 */
export const needsSystem: System = (world) => {
  for (const e of world.query(Settler)) {
    const settler = world.get(e, Settler);
    const risen = fx.add(settler.hunger, HUNGER_RISE_PER_TICK);
    settler.hunger = (risen > ONE ? ONE : risen) as Fixed;
  }
};
