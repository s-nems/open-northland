import { MusterPlan, type MusterPlanState } from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import type { WeaponMix } from './census.js';
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

const SECONDS_PER_HOUR = 3600;

/** Game time over which the band grows linearly from {@link OPENING_WAVE} to {@link LATE_WAVE}, then
 *  holds (authored). Three hours of game time is one hour of play at triple speed. */
export const WAVE_RAMP_TICKS = 3 * SECONDS_PER_HOUR * TICKS_PER_SECOND;

/** The wave band at game `tick`. */
export function waveBandAt(tick: number): WaveBand {
  const elapsed = Math.min(Math.max(tick, 0), WAVE_RAMP_TICKS);
  const grow = (from: number, to: number): number =>
    from + Math.floor(((to - from) * elapsed) / WAVE_RAMP_TICKS);
  return { min: grow(OPENING_WAVE.min, LATE_WAVE.min), max: grow(OPENING_WAVE.max, LATE_WAVE.max) };
}

/**
 * Whether the `band` at the door marches this decision: at the size its wave was drawn to, or once that
 * wave has been gathering for {@link WAVE_GATHER_TICKS} with the band's floor at the door, or every man
 * who could form up there (`gatherable`) when the seat has fewer than that floor. The size is held in
 * {@link MusterPlan} rather than drawn per decision, where the smallest draw would always be the one that
 * decides. `mustered` is the whole army, so a man off on an errand thins the band without retiring its
 * plan; only a loss does.
 */
export function decideWave(
  world: World,
  ctx: SystemContext,
  barracks: Entity,
  band: WeaponMix,
  mustered: number,
  gatherable: number,
  meleeCore: number,
): boolean {
  if (mustered < WAVE_MIN_SOLDIERS) {
    abandonWave(world, barracks);
    return false;
  }
  if (!waveWorthy(band, meleeCore)) return false;
  const plan = wavePlan(world, ctx, barracks);
  if (band.total < plan.waveSize) {
    if (ctx.tick - plan.drawnAt < WAVE_GATHER_TICKS) return false;
    if (band.total < Math.min(waveBandAt(ctx.tick).min, gatherable)) return false;
  }
  abandonWave(world, barracks);
  return true;
}

export function abandonWave(world: World, barracks: Entity): void {
  world.remove(barracks, MusterPlan);
}

/** The wave this door is gathering, drawn from the current {@link waveBandAt} on first sight of a worthy
 *  band. */
function wavePlan(world: World, ctx: SystemContext, barracks: Entity): MusterPlanState {
  const held = world.tryGet(barracks, MusterPlan);
  if (held !== undefined) return { waveSize: held.waveSize, drawnAt: held.drawnAt };
  const { min, max } = waveBandAt(ctx.tick);
  const waveSize = min + ctx.rng.int(max - min + 1);
  world.add(barracks, MusterPlan, { waveSize, drawnAt: ctx.tick });
  return { waveSize, drawnAt: ctx.tick };
}
