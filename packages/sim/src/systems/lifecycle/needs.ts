import { Age, Health, needsEnabled, Person, Settler } from '../../components/index.js';
import { type Fixed, fx, ONE } from '../../core/fixed.js';
import { TICKS_PER_SECOND } from '../../core/loop.js';
import type { Rng } from '../../core/rng.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System } from '../context.js';
import { tryDeathSaveDraught } from '../equipment/index.js';
import { declaresNoTrades, isFighterJob } from '../readviews/index.js';
import { isBaby } from './ageclass.js';

// Need rise rates, in fixed-point [0,ONE] units per tick.
//
// Approximation: the original drives needs through per-animation `atomicanimations.ini`
// `event <at> <channel> <delta>` tuples on an integer scale not yet decoded. Hunger, fatigue, and
// enjoyment instead share one constant rate calibrated to a 1x pace observed on the running original.
// Piety is the exception: it does not rise over time at all.

/** Seconds a need bar takes to lose 10% at 1x, observed on the running original. */
const SECONDS_PER_TEN_PERCENT_DRAIN = 80;
const TEN_PERCENT_STEPS_PER_BAR = 10;
const TICKS_TO_DRAIN_FULL_BAR = SECONDS_PER_TEN_PERCENT_DRAIN * TEN_PERCENT_STEPS_PER_BAR * TICKS_PER_SECOND;

export const HUNGER_RISE_PER_TICK: Fixed = fx.div(ONE, fx.fromInt(TICKS_TO_DRAIN_FULL_BAR));

export const FATIGUE_RISE_PER_TICK: Fixed = HUNGER_RISE_PER_TICK;

/** Enjoyment, the social/company bar, satisfied by the gossip drive; a fighter's is frozen instead. */
export const ENJOYMENT_RISE_PER_TICK: Fixed = HUNGER_RISE_PER_TICK;

/** A settler starts each need at a seeded random deficit up to this percent of a full bar, so a map
 * opens with varied satisfaction instead of everyone identically full. Authored: the original's
 * per-settler starting needs are below the readable data. */
export const NEED_INIT_MAX_DEFICIT_PERCENT = 50;

/** One seeded starting need deficit in `[0, NEED_INIT_MAX_DEFICIT_PERCENT%]` of a full bar. */
export function rollInitialNeed(rng: Rng): Fixed {
  const percent = rng.int(NEED_INIT_MAX_DEFICIT_PERCENT + 1);
  return fx.div(fx.fromInt(percent), fx.fromInt(100));
}

/**
 * How much of the hunger bar one meal takes off: 40%, whatever was eaten. Source basis: the eat clips
 * carry `event 30 2 +4000` on the CHANGE_ENERGY channel (`logicdefines.inc`
 * `ATOMIC_ANIMATION_EVENT_TYPE_CHANGE_ENERGY = 2`) against a ~10000-unit reserve span, and observation of
 * the running original puts one meal at 40% of the bar. A single flat restore is the approximation until
 * the per-clip vocabulary is wired.
 */
export const EAT_HUNGER_RESTORE: Fixed = fx.div(fx.fromInt(40), fx.fromInt(100));

/**
 * How much of the fatigue bar one sleep takes off: 20%, so rest is a repeated errand. Approximation: the
 * `..._sleep` clips pulse `event <at> 1 +4000` on the CHANGE_CONDITION channel, but that channel's reserve
 * span is not readable, so the fraction is pinned by observation of the running original instead.
 */
export const SLEEP_FATIGUE_RESTORE: Fixed = fx.div(fx.fromInt(20), fx.fromInt(100));

/** Take `amount` off a need bar, floored at zero. */
export function relieveNeed(current: Fixed, amount: Fixed): Fixed {
  const relieved = fx.sub(current, amount);
  return relieved < 0 ? fx.fromInt(0) : relieved;
}

/** How much piety a smith spends forging one weapon or piece of armor - the only thing that raises the
 * piety deficit, which praying at a temple clears. Authored; the magnitude is approximated. */
export const PIETY_PER_MILITARY_CYCLE: Fixed = fx.div(ONE, fx.fromInt(10)); // 10% of the bar per weapon/armor

/** Add {@link PIETY_PER_MILITARY_CYCLE} to a settler's piety deficit, clamped at {@link ONE}. */
export function chargeMilitaryPiety(world: World, settler: Entity): void {
  if (!needsEnabled(world)) return;
  if (!world.has(settler, Settler)) return;
  const s = world.get(settler, Settler);
  const risen = fx.add(s.piety, PIETY_PER_MILITARY_CYCLE);
  s.piety = risen > ONE ? ONE : risen;
}

/**
 * Ticks between starvation bites on a settler whose hunger is pinned at `ONE`. The beat keeps the
 * per-bite amount a meaningful integer across `Health.max` pools spanning 170..20000.
 */
export const STARVATION_DAMAGE_INTERVAL_TICKS = 10;
/**
 * Starvation bites needed to empty a full `Health` pool, each bite `max(1, trunc(max/240))`, so the
 * default 300-HP pool dies after 3000 ticks. Approximation: the original starves settlers to death, but
 * its rate rides the undecoded per-animation event scale.
 */
export const STARVATION_BITES_TO_DIE = 240;

/**
 * The rise half of settler needs, plus starvation damage. Each tick every person's `hunger` and `fatigue`
 * rise, and `enjoyment` too for every non-fighter, each clamped at `ONE`. `piety` is not touched here: it
 * climbs only through {@link chargeMilitaryPiety} and resets at a temple.
 *
 * Wildlife is out of the sweep structurally: the query is over {@link Person}. Two conventional gates sit
 * inside it. A person of a recorded tribe with no `jobEnables` is skipped - the maps place the monster
 * tribes as a seat's soldiers that no building can employ, so their bars would only ever pin. A baby is
 * skipped on the same state the planner gates on, so a fixture whose synthetic job id collides with an
 * age-class id still lives a full needs life.
 *
 * Approximation on both: `tribetypes.ini` binds the monster soldier an eat and a sleep clip
 * (`setatomic 31 10` / `31 8`), so the original's treatment of their bars is undecided rather than
 * answered here; and a baby is fed by its family.
 *
 * A settler pinned at `ONE` hunger loses hitpoints on the {@link STARVATION_DAMAGE_INTERVAL_TICKS} beat
 * until it is fed or the pool empties. A jobless settler is exempt: the eat drive lives in the job
 * planner, which skips it, so nothing could feed it. The whole system is gated by the
 * {@link needsEnabled} world rule.
 */
export const needsSystem: System = (world, ctx) => {
  if (!needsEnabled(world)) return;
  const starvationBeat = ctx.tick % STARVATION_DAMAGE_INTERVAL_TICKS === 0;
  for (const e of world.query(Person)) {
    const settler = world.get(e, Settler);
    if (declaresNoTrades(ctx.content, settler.tribe)) continue;
    if (world.has(e, Age) && isBaby(settler.jobType)) continue;
    const risenHunger = fx.add(settler.hunger, HUNGER_RISE_PER_TICK);
    settler.hunger = risenHunger > ONE ? ONE : risenHunger;
    const risenFatigue = fx.add(settler.fatigue, FATIGUE_RISE_PER_TICK);
    settler.fatigue = risenFatigue > ONE ? ONE : risenFatigue;
    if (!isFighterJob(ctx.content, settler.jobType)) {
      const risenEnjoyment = fx.add(settler.enjoyment, ENJOYMENT_RISE_PER_TICK);
      settler.enjoyment = risenEnjoyment > ONE ? ONE : risenEnjoyment;
    }
    // Only a settler that could have fed itself bleeds; the 0-HP reap is CleanupSystem's.
    if (starvationBeat && settler.hunger === ONE && settler.jobType !== null && world.has(e, Health)) {
      const health = world.get(e, Health);
      const bite = Math.max(1, Math.trunc(health.max / STARVATION_BITES_TO_DIE));
      // The healing draught's death-save may answer a lethal bite; a settler already at 0 and awaiting
      // cleanup is not revived.
      if (health.hitpoints > 0 && health.hitpoints - bite <= 0 && tryDeathSaveDraught(world, ctx, e))
        continue;
      health.hitpoints = Math.max(0, health.hitpoints - bite);
    }
  }
};
