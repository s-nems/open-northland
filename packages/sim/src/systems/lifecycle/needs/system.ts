import type { ContentSet } from '@open-northland/data';
import { Age, Health, needsEnabled, Person, Settler } from '../../../components/index.js';
import { type Fixed, ONE } from '../../../core/fixed.js';
import type { Rng } from '../../../core/rng.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { System, SystemContext } from '../../context.js';
import { tryDeathSaveDraught } from '../../equipment/index.js';
import { declaresNoTrades, isFighterJob } from '../../readviews/index.js';
import { applyNeedUnits, NEED_DRAIN_UNITS_PER_TICK, NEED_RESERVE_UNITS, needBar } from './scale.js';

/** The spread of a settler's starting deficit, half a bar, so a map opens with varied satisfaction instead
 *  of everyone identically full. Authored: per-settler starting needs are below the readable data. */
export const NEED_INIT_SPREAD_UNITS = NEED_RESERVE_UNITS / 2;

/** One seeded starting deficit in `[0, NEED_INIT_SPREAD_UNITS)` reserve units. */
export function rollInitialNeed(rng: Rng): Fixed {
  return needBar(rng.int(NEED_INIT_SPREAD_UNITS));
}

/** Move a settler's piety by `units` of the reserve, the sign the data writes: a forge clip's `-1500` or
 *  `-3000` spends it, a prayer's `+800` pulses serve it. */
export function chargeMilitaryPiety(world: World, settler: Entity, units: number): void {
  if (units === 0 || !needsEnabled(world)) return;
  if (!world.has(settler, Settler)) return;
  const s = world.mut(settler, Settler);
  s.piety = applyNeedUnits(s.piety, units);
}

/**
 * Ticks between the hitpoint steps starvation and healing take. The beat keeps each step a meaningful
 * integer across `Health.max` pools spanning 170..20000.
 */
export const HEALTH_STEP_INTERVAL_TICKS = 10;

/**
 * Starvation steps to empty a full `Health` pool, each `max(1, trunc(max/240))`, so the default 300-HP
 * pool dies after 3000 ticks. Approximation: the original starves an unfed settler to death, but the rate
 * is authored.
 */
export const STARVATION_BITES_TO_DIE = 240;

/** Healing steps to refill an empty pool: a fed settler recovers at half the rate an unfed one wastes.
 *  Approximation, on {@link STARVATION_BITES_TO_DIE}' basis. */
export const HEAL_STEPS_TO_FULL = STARVATION_BITES_TO_DIE * 2;

/**
 * The rise half of settler needs, plus the hitpoint step. `piety` is not touched here: it climbs only
 * through {@link chargeMilitaryPiety} and falls at a temple.
 *
 * Only a grown settler of a trading tribe carries needs. Byte evidence for the age gate: in the owned copy
 * both the per-tick drain and the urgent-need check return early unless the human is an adult, so the child
 * eat and sleep clips `tribetypes.ini` binds (`setatomic 3/4 8/10`) are ones a child is played, never ones
 * it seeks. A person of a recorded tribe with no `jobEnables` is skipped on an approximation: the maps place
 * the monster tribes as a seat's soldiers no building can employ, so their bars would only ever pin.
 *
 * Hitpoints move on their own beat for everyone, fed or not: a settler whose hunger has pinned loses them
 * until it eats or the pool empties, and any other wounded settler regains them.
 */
export const needsSystem: System = (world, ctx) => {
  if (!needsEnabled(world)) return;
  const healthBeat = ctx.tick % HEALTH_STEP_INTERVAL_TICKS === 0;
  for (const e of world.query(Person)) {
    const bars = carriesNeeds(world, ctx.content, e);
    if (bars) drainNeeds(world, ctx, e);
    if (healthBeat) stepHealth(world, ctx, e, bars);
  }
};

/** Whether `e`'s bars move at all - the one gate the drain and the clip events share. */
export function carriesNeeds(world: World, content: ContentSet, e: Entity): boolean {
  const settler = world.tryGet(e, Settler);
  return settler !== undefined && !world.has(e, Age) && !declaresNoTrades(content, settler.tribe);
}

/** Drain one tick off the three needs time alone moves; a fighter's company need is frozen instead. */
function drainNeeds(world: World, ctx: SystemContext, e: Entity): void {
  const settler = world.mut(e, Settler);
  settler.hunger = applyNeedUnits(settler.hunger, -NEED_DRAIN_UNITS_PER_TICK);
  settler.fatigue = applyNeedUnits(settler.fatigue, -NEED_DRAIN_UNITS_PER_TICK);
  if (!isFighterJob(ctx.content, settler.jobType)) {
    settler.enjoyment = applyNeedUnits(settler.enjoyment, -NEED_DRAIN_UNITS_PER_TICK);
  }
}

/**
 * One hitpoint step: starvation for a grown settler whose hunger has pinned, healing for anyone else off
 * a full pool. A jobless settler never starves: the eat drive lives in the job planner, which skips it, so
 * nothing could feed it. The 0-HP reap is CleanupSystem's.
 */
function stepHealth(world: World, ctx: SystemContext, e: Entity, bars: boolean): void {
  const health = world.tryGet(e, Health);
  if (health === undefined || health.hitpoints <= 0) return;
  const settler = world.get(e, Settler);
  if (bars && settler.hunger === ONE && settler.jobType !== null) {
    const bite = Math.max(1, Math.trunc(health.max / STARVATION_BITES_TO_DIE));
    // The healing draught's death-save may answer a lethal bite.
    if (health.hitpoints - bite <= 0 && tryDeathSaveDraught(world, ctx, e)) return;
    world.mut(e, Health).hitpoints = Math.max(0, health.hitpoints - bite);
    return;
  }
  if (health.hitpoints >= health.max) return;
  const heal = Math.max(1, Math.trunc(health.max / HEAL_STEPS_TO_FULL));
  world.mut(e, Health).hitpoints = Math.min(health.max, health.hitpoints + heal);
}
