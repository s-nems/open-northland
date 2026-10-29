import { MusterPlan, type MusterPlanState } from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { WeaponMix } from '../../ai-shared/military/census.js';
import type { SystemContext } from '../../context.js';
import type { Share } from '../difficulty.js';
import { WAVE_MIN_SOLDIERS, waveWorthy } from './muster.js';

/** How long one wave gathers before it marches without its drawn size. Absolute rather than keyed on
 *  reinforcements, which a seat that keeps drafting would renew for the rest of the game. Approximation. */
export const WAVE_GATHER_TICKS = 240 * TICKS_PER_SECOND;

/** The size band a wave is drawn from, inclusive at both ends. */
export interface WaveBand {
  readonly min: number;
  readonly max: number;
}

/** The first waves: a raid-sized band (authored). */
export const OPENING_WAVE: WaveBand = { min: WAVE_MIN_SOLDIERS, max: 10 };

/** The late-game assault the band grows into (authored). */
export const LATE_WAVE: WaveBand = { min: 50, max: 100 };

/** The army a hard seat never holds past (authored): from this many live fighters the door sends the
 *  band it has, whatever size the wave was drawn to and whatever the odds, so a seat whose build order
 *  has settled does not hoard two hundred men at its barracks. It still waits for the men walking in,
 *  up to one gather window from the tick the cap was first reached, so the army leaves as one wave and
 *  not in the fives that form up between decisions. */
export const ARMY_CAP_SOLDIERS = 150;

const SECONDS_PER_HOUR = 3600;

/** Game time over which the band grows linearly from {@link OPENING_WAVE} to {@link LATE_WAVE}, counted
 *  from the end of the peace, then holds (authored). Three hours of game time is one hour of play at
 *  triple speed. */
export const WAVE_RAMP_TICKS = 3 * SECONDS_PER_HOUR * TICKS_PER_SECOND;

/** The wave band `sincePeace` ticks after the peace ended. */
export function waveBandAt(sincePeace: number): WaveBand {
  const elapsed = Math.min(Math.max(sincePeace, 0), WAVE_RAMP_TICKS);
  const grow = (from: number, to: number): number =>
    from + Math.floor(((to - from) * elapsed) / WAVE_RAMP_TICKS);
  return {
    min: grow(OPENING_WAVE.min, LATE_WAVE.min),
    max: grow(OPENING_WAVE.max, LATE_WAVE.max),
  };
}

/** The seat's whole army in points against the points it believes the target's owner defends with
 *  (`enemy-strength.ts`, `points.ts`): garrisons and men in a fight included on both sides, his tower posts
 *  weighed for the men they kill. `ownMen` is the seat's head count, which the army cap counts. */
export interface Strength {
  readonly own: number;
  readonly opposing: number;
  readonly ownMen: number;
}

/** The seat's free men as its door counts them this decision. */
export interface DoorCount {
  /** The whole army, so a man off on an errand thins the band without retiring its plan; only a loss
   *  does. */
  readonly mustered: number;
  /** The most the door can ever gather: the free men on its own ground. A man across water or out on
   *  an errand never forms up. */
  readonly gatherable: number;
  /** The gatherable men still walking in, who form up over the next decisions. */
  readonly walkingIn: number;
}

/** Whether `own` points reach `ratio` of `opposing`: the launch edge the seat's plan sets
 *  (`strategy/military.ts`), cross-multiplied so nothing divides. */
export function launchRatioReached(own: number, opposing: number, ratio: Share): boolean {
  return own * ratio.den >= opposing * ratio.num;
}

/**
 * Whether the `band` at the door marches this decision: at the size its wave was drawn to, or once that
 * wave has been gathering for {@link WAVE_GATHER_TICKS} with the band's floor at the door, or every man
 * who could form up there (`door.gatherable`) when the seat has fewer than that floor. The size is held
 * in {@link MusterPlan} rather than drawn per decision, where the smallest draw would always be the one
 * that decides, and redrawn once the band it was drawn from has grown past it.
 *
 * Nothing marches while the seat's points fall short of `launchRatio` of the target owner's
 * ({@link launchRatioReached}), not even on a spent window: the band keeps gathering and the plan is kept. Both sides are whole armies, the seat's own beyond
 * `door.mustered`, since a garrison defends what a wave would take and the seat's towers should not bench
 * the band at its door. The one rule above all of that is the seat's `armyCap` ({@link ARMY_CAP_SOLDIERS}
 * on hard): an army that size goes in whole, once its men walking in have arrived or the window has run
 * out on a man who never does.
 */
export function decideWave(
  world: World,
  ctx: SystemContext,
  barracks: Entity,
  band: WeaponMix,
  door: DoorCount,
  meleeCore: number,
  peaceEnd: number,
  strength: Strength,
  armyCap: number,
  launchRatio: Share,
): boolean {
  if (door.mustered < WAVE_MIN_SOLDIERS) {
    abandonWave(world, barracks);
    return false;
  }
  if (!waveWorthy(band, meleeCore)) return false;
  const plan = wavePlan(world, ctx, barracks, peaceEnd);
  const windowOpen = ctx.tick - plan.drawnAt < WAVE_GATHER_TICKS;
  if (strength.ownMen >= armyCap) {
    const cappedAt = plan.cappedAt ?? ctx.tick;
    if (plan.cappedAt === null) world.mut(barracks, MusterPlan).cappedAt = cappedAt;
    if (door.walkingIn > 0 && ctx.tick - cappedAt < WAVE_GATHER_TICKS) return false;
    abandonWave(world, barracks);
    return true;
  }
  if (!launchRatioReached(strength.own, strength.opposing, launchRatio)) return false;
  if (band.total < plan.waveSize) {
    if (windowOpen) return false;
    if (band.total < Math.min(waveBandAt(ctx.tick - peaceEnd).min, door.gatherable)) return false;
  }
  abandonWave(world, barracks);
  return true;
}

export function abandonWave(world: World, barracks: Entity): void {
  world.remove(barracks, MusterPlan);
}

/** The wave this door is gathering, drawn from the current {@link waveBandAt} on first sight of a worthy
 *  band. A size the band has since outgrown is drawn again from the current band, keeping the window it
 *  started, so an opening raid's draw does not send a late-game army out at ten. */
function wavePlan(world: World, ctx: SystemContext, barracks: Entity, peaceEnd: number): MusterPlanState {
  const { min, max } = waveBandAt(ctx.tick - peaceEnd);
  const held = world.tryGet(barracks, MusterPlan);
  if (held !== undefined && held.waveSize >= min) return { ...held };
  const waveSize = min + ctx.rng.int(max - min + 1);
  const plan = { waveSize, drawnAt: held?.drawnAt ?? ctx.tick, cappedAt: held?.cappedAt ?? null };
  world.add(barracks, MusterPlan, plan);
  return plan;
}
