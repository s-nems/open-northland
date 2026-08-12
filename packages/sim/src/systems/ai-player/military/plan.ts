import { MusterPlan } from '../../../components/index.js';
import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import type { WeaponMix } from './census.js';
import { WAVE_FULL_SOLDIERS, WAVE_MIN_SOLDIERS, waveWorthy } from './muster.js';

/** How long one wave gathers before it marches with whatever stands at the door. Absolute rather than keyed
 *  on reinforcements, which a seat that keeps drafting would renew for the rest of the game. Approximation. */
export const WAVE_GATHER_TICKS = 240 * TICKS_PER_SECOND;

/**
 * Whether the `band` gathered at the door marches this decision: at the size its wave was drawn to, or once
 * that wave has been gathering for {@link WAVE_GATHER_TICKS}. The size is held in {@link MusterPlan} rather
 * than drawn per decision, where the smallest draw would always be the one that decides. Approximation: the
 * autonomous HAI exposes only `HAI_DisableMilitary`.
 *
 * Owns the plan outright - minted when a band first stands at the door, retired both when the band falls
 * under a wave and when it marches, so the next wave draws its own size and window.
 */
export function decideWave(
  world: World,
  ctx: SystemContext,
  barracks: Entity,
  band: WeaponMix,
  meleeCore: number,
): boolean {
  if (band.total < WAVE_MIN_SOLDIERS) {
    world.remove(barracks, MusterPlan);
    return false;
  }
  const plan = wavePlan(world, ctx, barracks);
  if (!waveWorthy(band, meleeCore)) return false;
  if (band.total < plan.waveSize && ctx.tick - plan.drawnAt < WAVE_GATHER_TICKS) return false;
  world.remove(barracks, MusterPlan);
  return true;
}

/** The wave this door is gathering, drawn on first sight of a band. */
function wavePlan(
  world: World,
  ctx: SystemContext,
  barracks: Entity,
): { readonly waveSize: number; readonly drawnAt: number } {
  const held = world.tryGet(barracks, MusterPlan);
  if (held !== undefined) return { waveSize: held.waveSize, drawnAt: held.drawnAt };
  const waveSize = WAVE_MIN_SOLDIERS + ctx.rng.int(WAVE_FULL_SOLDIERS - WAVE_MIN_SOLDIERS + 1);
  world.add(barracks, MusterPlan, { waveSize, drawnAt: ctx.tick });
  return { waveSize, drawnAt: ctx.tick };
}
