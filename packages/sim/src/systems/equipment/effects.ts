import { Equipment, type EquipmentSlot, Health, Settler } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { type Fixed, fx, ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isCarrierJob } from '../stores/index.js';
import { applyEquipWear, wearStepOf } from './wear.js';

// The worn-equipment effect reads: what a worn good grants its bearer, resolved from the content equip
// axis with no id-specific rules. A spent unit (degreeOfUse >= ONE) grants nothing.

/** An integer percent as a Fixed fraction - one deterministic truncating division (at most an ulp low). */
const pctFraction = (pct: number): Fixed => fx.div(fx.fromInt(pct), fx.fromInt(100));

/** The content equip axis of the good in a live (non-spent) slot, or undefined. */
function liveEquipOf(ctx: SystemContext, slot: EquipmentSlot | null) {
  if (slot === null || slot.degreeOfUse >= ONE) return undefined;
  return contentIndex(ctx.content).goods.get(slot.goodType)?.equip;
}

/** Whether `operator` crafts for itself: a non-carrier with a trade. The shared gate for the tool credit
 *  and tool wear, since a carrier-run utility's delivery work is not crafting. */
export function isCraftingOperator(world: World, ctx: SystemContext, operator: Entity): boolean {
  const s = world.tryGet(operator, Settler);
  return s !== undefined && s.jobType !== null && !isCarrierJob(ctx, s.jobType);
}

/** A crafting operator's ADDITIVE per-cycle tool credit in whole percent of the recipe outputs (the
 *  schema's `productionBonusPct`). 0 for a carrier operator, a no/spent tool, or an unrated good. */
export function toolProductionBonusPct(world: World, ctx: SystemContext, operator: Entity): number {
  if (!isCraftingOperator(world, ctx, operator)) return 0;
  const tool = world.tryGet(operator, Equipment)?.tool ?? null;
  return liveEquipOf(ctx, tool)?.productionBonusPct ?? 0;
}

/** The work factor of bare hands, in percent: what a worker with no live tool works at. */
export const BARE_HANDS_WORK_FACTOR_PCT = 100;

/** A worker's tool work factor in percent for strokes and build swings (the schema's `workFactorPct`):
 *  bare hands for a no/spent tool or an unrated good. */
export function toolWorkFactorPct(world: World, ctx: SystemContext, worker: Entity): number {
  const tool = world.tryGet(worker, Equipment)?.tool ?? null;
  return liveEquipOf(ctx, tool)?.workFactorPct ?? BARE_HANDS_WORK_FACTOR_PCT;
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
 * The healing draught's death save: called where a lethal blow is about to land, it drinks one sip of the
 * lowest-indexed live healing draught and sets the bearer to its restore percent of max hitpoints, floored
 * at 1, instead of dying. Instant, since death is instant, so no atomic plays.
 *
 * Authored deviation from the manual, which triggers the potion on injury ("A soldier equipped with this
 * potion will automatically take it when he is injured by an enemy or wild beast", p. 18): a bottle is
 * worth one life rather than a top-up, and the starvation bite gets the same protection.
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
    const h = world.mut(e, Health);
    h.hitpoints = Math.max(1, Math.trunc((h.max * pct) / 100));
    applyEquipWear(world, e, 'misc', slot, wearStepOf(ctx, held.goodType));
    return true;
  }
  return false;
}
