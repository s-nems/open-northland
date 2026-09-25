import { Equipment, type EquipmentSlot, Settler } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isCarrierJob } from '../stores/index.js';

// The worn-equipment effect reads: what a worn good grants its bearer, resolved from the content equip
// axis with no id-specific rules. A spent unit (degreeOfUse >= ONE) grants nothing.

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
