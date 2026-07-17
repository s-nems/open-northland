import { Age, Health, needsEnabled, Settler } from '../../components/index.js';
import { type Fixed, fx, ONE } from '../../core/fixed.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Rng } from '../../core/rng.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System } from '../context.js';
import { isFighterJob } from '../readviews/index.js';
import { isBaby } from './ageclass.js';

// Need rise rates, in fixed-point [0,ONE] units per tick.
//
// source-basis (approximated): the original drives needs through per-animation `atomicanimations.ini`
// `event <at> <channel> <delta>` tuples — an activity drains a channel while a satisfying animation restores it
// — on a large integer scale not yet decoded. Hunger, fatigue, and enjoyment instead rise at a shared constant
// rate calibrated to an observed 1× pace (user measurement): a bar loses 10% every 1min20s, so a full bar
// drains in 800 s. Piety is the exception — it does not rise over time at all (see the header of
// {@link needsSystem}).

/** Seconds a need bar takes to lose 10% at 1× (user's measured target); a full bar is ten such steps. */
const SECONDS_PER_TEN_PERCENT_DRAIN = 80;
const TEN_PERCENT_STEPS_PER_BAR = 10;
const TICKS_TO_DRAIN_FULL_BAR = SECONDS_PER_TEN_PERCENT_DRAIN * TEN_PERCENT_STEPS_PER_BAR * TICKS_PER_SECOND;

/** Fills an empty bar in {@link TICKS_TO_DRAIN_FULL_BAR} ticks (10% per 1min20s at 1×). */
export const HUNGER_RISE_PER_TICK: Fixed = fx.div(ONE, fx.fromInt(TICKS_TO_DRAIN_FULL_BAR));

/** Fatigue drains at the same rate as hunger (user rule). */
export const FATIGUE_RISE_PER_TICK: Fixed = HUNGER_RISE_PER_TICK;

/** Enjoyment (the social/company bar) drains at the same rate as hunger — but only for non-fighters; a
 * soldier's/hero's company need is frozen (see {@link needsSystem}). Its channel-3 resets are wired
 * (AtomicSystem), but the drive is deferred: `enjoy` has no readable building satisfier to walk to, so a
 * civilian's bar sits pinned once spent (cosmetic — enjoyment carries no penalty, unlike hunger). */
export const ENJOYMENT_RISE_PER_TICK: Fixed = HUNGER_RISE_PER_TICK;

/** A settler starts each need at a seeded random deficit between 0 and this percent of a full bar, so a map
 * opens with varied 50–100% satisfaction (the HUD shows `100 − deficit`) instead of everyone identically
 * full. Source basis: design rule (user-specified); the original's per-settler starting needs are below the
 * readable data. */
export const NEED_INIT_MAX_DEFICIT_PERCENT = 50;

/** One seeded starting need deficit in `[0, NEED_INIT_MAX_DEFICIT_PERCENT%]` of a full bar. Drawn from the
 * injected {@link Rng} (the sim's only legal randomness) at spawn — deterministic for a given seed. */
export function rollInitialNeed(rng: Rng): Fixed {
  const percent = rng.int(NEED_INIT_MAX_DEFICIT_PERCENT + 1); // 0..50 percent of a full bar
  return fx.div(fx.fromInt(percent), fx.fromInt(100));
}

/** How much piety a smith spends forging one weapon or piece of armor — the only thing that raises the piety
 * deficit now that it no longer rises over time (praying at a temple clears it). Applied once per completed
 * military-good production cycle to the worker on station (ProductionSystem). Source basis: design rule
 * (user-specified — the gods frown on arms-making); the magnitude is approximated. */
export const PIETY_PER_MILITARY_CYCLE: Fixed = fx.div(ONE, fx.fromInt(10)); // 10% of the bar per weapon/armor

/** Add {@link PIETY_PER_MILITARY_CYCLE} to a settler's piety deficit, clamped at {@link ONE} — the smith's
 * cost for forging one weapon/armor good. No-op if the entity is not (or no longer) a {@link Settler}. */
export function chargeMilitaryPiety(world: World, settler: Entity): void {
  if (!world.has(settler, Settler)) return;
  const s = world.get(settler, Settler);
  const risen = fx.add(s.piety, PIETY_PER_MILITARY_CYCLE);
  s.piety = risen > ONE ? ONE : risen;
}

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
 * Each tick every {@link Settler}'s `hunger` and `fatigue` rise by their rate above, and `enjoyment` too for
 * every non-fighter (a soldier's/hero's company need is frozen — {@link isFighterJob}, user rule). Each is
 * clamped at `ONE` (a fully-spent settler stays pinned at the top of its bar until it acts — the
 * `hungerInRange`/`fatigueInRange`/`enjoymentInRange` invariants require the need ∈ [0, ONE]). `piety` is not
 * touched here: it climbs only when the settler forges a weapon/armor good ({@link chargeMilitaryPiety},
 * driven by ProductionSystem, which applies its own `pietyInRange` clamp) and resets at a temple (the `pray`
 * drive). Every named non-food need has its atomic reset wired (sleep/pray/enjoy/make_love); only the eat,
 * sleep, and pray *drives* exist so far.
 *
 * A BABY ({@link Age} carrier in a baby stage) is skipped whole: it is cared for — its family keeps it
 * fed and rested, so no need accumulates and it never starves (named approximation: the original's
 * baby care is below the readable data, and a baby has no eat binding to act on a need anyway). It
 * weans into childhood with its birth needs, and from there the child eat/sleep drives take over
 * (`ai.ts`). Keyed on Age + stage like the planner's gate, so an adult fixture whose synthetic job id
 * collides with a baby id still lives a full needs life.
 *
 * Starvation: a settler whose hunger is pinned at `ONE` loses hitpoints on the
 * {@link STARVATION_DAMAGE_INTERVAL_TICKS} beat until the eat drive feeds it or the pool empties (the
 * CleanupSystem then reaps it like any other death). Exempt, because nothing can feed them today and
 * starving them would only depopulate the map — a named approximation each:
 *  - ANIMALS (`jobType` null): no eat/graze mechanic yet;
 *  - JOBLESS settlers (also `jobType` null — e.g. a worker whose workplace was demolished): the eat drive
 *    lives in the job planner, which skips a jobless settler (`ai.ts` planNeeds).
 * A CHILD is NOT exempt — the planner runs the eat drive for it, so like an adult it starves only when
 * food is truly absent.
 *
 * The whole system is gated by the {@link needsEnabled} world rule (the `setNeedsEnabled` command):
 * disabled, needs freeze where they are and starvation stops — the dev/admin lever scenes default to.
 */
export const needsSystem: System = (world, ctx) => {
  if (!needsEnabled(world)) return;
  const starvationBeat = ctx.tick % STARVATION_DAMAGE_INTERVAL_TICKS === 0;
  for (const e of world.query(Settler)) {
    const settler = world.get(e, Settler);
    // A cared-for baby accumulates nothing and never starves (see the header) — skipped whole.
    if (world.has(e, Age) && isBaby(settler.jobType)) continue;
    const risenHunger = fx.add(settler.hunger, HUNGER_RISE_PER_TICK);
    settler.hunger = risenHunger > ONE ? ONE : risenHunger;
    const risenFatigue = fx.add(settler.fatigue, FATIGUE_RISE_PER_TICK);
    settler.fatigue = risenFatigue > ONE ? ONE : risenFatigue;
    // Enjoyment (company) rises only for non-fighters; a soldier's/hero's stays put. Piety never rises here
    // (forging weapons/armor is its only source — chargeMilitaryPiety).
    if (!isFighterJob(settler.jobType)) {
      const risenEnjoyment = fx.add(settler.enjoyment, ENJOYMENT_RISE_PER_TICK);
      settler.enjoyment = risenEnjoyment > ONE ? ONE : risenEnjoyment;
    }
    // Only a settler that COULD have fed itself bleeds hitpoints (see the header for the exemptions;
    // babies never reach here). The 0-HP reap (and its settlerDied event) is CleanupSystem's.
    if (starvationBeat && settler.hunger === ONE && settler.jobType !== null && world.has(e, Health)) {
      const health = world.get(e, Health);
      const bite = Math.max(1, Math.trunc(health.max / STARVATION_BITES_TO_DIE));
      health.hitpoints = Math.max(0, health.hitpoints - bite);
    }
  }
};
