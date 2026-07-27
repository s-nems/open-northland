import { Equipment, type EquipmentSlot, Health, Settler } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { type Fixed, fx, ONE, ZERO } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isCarrierJob } from '../stores/index.js';
import { applyEquipWear, wearStepOf } from './wear.js';

// The worn-equipment effect reads: what a worn good currently grants its bearer, resolved from the
// content equip axis (`EquipClass` owns the fields and the balance provenance) - no id-specific
// rules here. A spent unit (degreeOfUse >= ONE) grants nothing.

/** An integer percent as a Fixed fraction - one deterministic truncating division (at most an ulp low). */
const pctFraction = (pct: number): Fixed => fx.div(fx.fromInt(pct), fx.fromInt(100));

/** The content equip axis of the good in a live (non-spent) slot, or undefined. */
function liveEquipOf(ctx: SystemContext, slot: EquipmentSlot | null) {
  if (slot === null || slot.degreeOfUse >= ONE) return undefined;
  return contentIndex(ctx.content).goods.get(slot.goodType)?.equip;
}

/** The mover's worn-boots gait bonus in [0, ONE] - ZERO without Equipment, boots, or a rated bonus. */
export function bootsSpeedBonus(world: World, ctx: SystemContext, e: Entity): Fixed {
  const boots = world.tryGet(e, Equipment)?.boots ?? null;
  const pct = liveEquipOf(ctx, boots)?.speedBonusPct;
  return pct === undefined ? ZERO : pctFraction(pct);
}

/** Whether `operator` crafts for itself: a non-carrier with a trade. The tool credit's and tool wear's
 *  shared gate (a carrier-run utility's delivery work is not crafting - the same exclusion the XP
 *  bonus applies in {@link import('../progression/index.js').operatorProductionBonus}). */
export function isCraftingOperator(world: World, ctx: SystemContext, operator: Entity): boolean {
  const s = world.tryGet(operator, Settler);
  return s !== undefined && s.jobType !== null && !isCarrierJob(ctx, s.jobType);
}

/** A crafting operator's ADDITIVE per-cycle tool credit in [0, ONE] (see the schema's
 *  `productionBonusPct`). ZERO for a carrier operator, a no/spent tool, or an unrated good. */
export function toolProductionBonus(world: World, ctx: SystemContext, operator: Entity): Fixed {
  if (!isCraftingOperator(world, ctx, operator)) return ZERO;
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
 * The healing draught's DEATH-SAVE: called where a lethal blow/bite is about to land, it drinks one sip
 * of the lowest-indexed live healing draught and sets the bearer to its restore percent of max
 * hitpoints (floored at 1) instead of dying. Instant - death is instant, so no atomic plays. Returns
 * false when no draught is held (the caller kills as before).
 *
 * Named deviation from the manual, which triggers the potion on injury ("A soldier equipped with this
 * potion will automatically take it when he is injured by an enemy or wild beast", p. 18): the user
 * chose a death-save instead (2026-07-24), so a bottle is worth one life rather than a top-up, and the
 * starvation bite gets the same protection.
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
    world.touch(e); // log the in-place Health write (the direct-field-write convention)
    applyEquipWear(world, e, 'misc', slot, wearStepOf(ctx, held.goodType));
    return true;
  }
  return false;
}
