import { Equipment, Health, Settler } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { type Fixed, fx, ONE, ZERO } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isCarrierJob } from '../stores/index.js';
import { applyEquipWear, wearStepOf } from './wear.js';

// The worn-equipment effect reads: what a worn good currently grants its bearer, resolved from the
// content equip axis (`EquipClass` - category, wear, and the integer-percent effect fields). Every
// magnitude is content data (user-rule balance; the engine's values are unreadable) - no id-specific
// rules here. A spent unit (degreeOfUse >= ONE) grants nothing.

/** An integer percent as a Fixed fraction - exact (100 divides ONE's scale). */
const pctFraction = (pct: number): Fixed => fx.div(fx.fromInt(pct), fx.fromInt(100));

/** The content equip axis of the good in a live (non-spent) slot, or undefined. */
function liveEquipOf(ctx: SystemContext, slot: { goodType: number; degreeOfUse: Fixed } | null) {
  if (slot === null || slot.degreeOfUse >= ONE) return undefined;
  return contentIndex(ctx.content).goods.get(slot.goodType)?.equip;
}

/** The mover's worn-boots gait bonus in [0, ONE] - ZERO without Equipment, boots, or a rated bonus. */
export function bootsSpeedBonus(world: World, ctx: SystemContext, e: Entity): Fixed {
  const boots = world.tryGet(e, Equipment)?.boots ?? null;
  const pct = liveEquipOf(ctx, boots)?.speedBonusPct;
  return pct === undefined ? ZERO : pctFraction(pct);
}

/**
 * A production operator's ADDITIVE per-cycle tool credit in [0, ONE] - added to the experience bonus
 * fraction, never multiplied (user rule 2026-07-24). ZERO for a carrier operator (a carrier-run
 * utility's delivery work is not crafting - mirrors the XP exclusion in
 * {@link import('../progression/index.js').operatorProductionBonus}), no/spent tool, or an unrated good.
 */
export function toolProductionBonus(world: World, ctx: SystemContext, operator: Entity): Fixed {
  const s = world.tryGet(operator, Settler);
  if (s === undefined || s.jobType === null || isCarrierJob(ctx, s.jobType)) return ZERO;
  const tool = world.tryGet(operator, Equipment)?.tool ?? null;
  const pct = liveEquipOf(ctx, tool)?.productionBonusPct;
  return pct === undefined ? ZERO : pctFraction(pct);
}

/** One sip's restores for a draught good: needs as Fixed fractions, health as a whole percent of the
 *  bearer's max hitpoints. All-undefined for a non-draught. */
export function draughtRestores(
  ctx: SystemContext,
  goodType: number,
): { hunger?: Fixed; fatigue?: Fixed; healthMaxPct?: number } {
  const restore = contentIndex(ctx.content).goods.get(goodType)?.equip?.restorePct;
  if (restore === undefined) return {};
  return {
    ...(restore.hunger === undefined ? {} : { hunger: pctFraction(restore.hunger) }),
    ...(restore.fatigue === undefined ? {} : { fatigue: pctFraction(restore.fatigue) }),
    ...(restore.healthMax === undefined ? {} : { healthMaxPct: restore.healthMax }),
  };
}

/**
 * The healing draught's DEATH-SAVE (user rule 2026-07-24: it protects at the moment of death and
 * regenerates then): called where a lethal blow/bite is about to land, it drinks one sip of the
 * lowest-indexed live healing draught and sets the bearer to its restore percent of max hitpoints
 * (floored at 1) instead of dying. Instant - death is instant, so no atomic plays. Returns false
 * when no draught is held (the caller kills as before).
 */
export function tryDeathSaveDraught(world: World, ctx: SystemContext, e: Entity): boolean {
  const eq = world.tryGet(e, Equipment);
  const health = world.tryGet(e, Health);
  if (eq === undefined || health === undefined) return false;
  for (let slot = 0; slot < eq.misc.length; slot++) {
    const held = eq.misc[slot] ?? null;
    if (held === null) continue;
    const pct = liveEquipOf(ctx, held)?.restorePct?.healthMax;
    if (pct === undefined) continue;
    health.hitpoints = Math.max(1, Math.trunc((health.max * pct) / 100));
    world.touch(e); // Health written in place (the wear below may whiff on an unrated good)
    applyEquipWear(world, e, 'misc', slot, wearStepOf(ctx, held.goodType));
    return true;
  }
  return false;
}
