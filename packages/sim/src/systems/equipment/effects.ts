import type { ContentSet, EquipClass } from '@open-northland/data';
import { Equipment, type EquipmentSlot, Health, Settler } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isCarrierJob } from '../stores/index.js';

// The worn-equipment effect reads: what a worn good grants its bearer, resolved from the content equip
// axis with no id-specific rules. A spent unit (degreeOfUse >= ONE) grants nothing.

const PERCENT = 100;

/** The content equip axis of the good in a live (non-spent) slot, or undefined. */
function liveEquipOf(content: ContentSet, slot: EquipmentSlot | null | undefined): EquipClass | undefined {
  if (slot == null || slot.degreeOfUse >= ONE) return undefined;
  return contentIndex(content).goods.get(slot.goodType)?.equip;
}

type CarriedEffect = 'damageDealtPct' | 'criticalHit' | 'damageTakenPct' | 'walkStepTicksSaved';

/** A carried effect of `e`'s misc row: the first live slot's value, so a second copy adds nothing. */
function carriedEffect<K extends CarriedEffect>(
  world: World,
  content: ContentSet,
  e: Entity,
  effect: K,
): EquipClass[K] | undefined {
  const misc = world.tryGet(e, Equipment)?.misc;
  if (misc === undefined) return undefined;
  for (const held of misc) {
    const value = liveEquipOf(content, held)?.[effect];
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * A landed blow's damage after the striker's carried effects. Original behavior, for a blow on any
 * target: the strength amulet multiplies by 3/2, rounding down, then the critical-hit amulet doubles one
 * blow in five, drawn only while it is carried. A striker already dead carries none.
 */
export function damageDealtBy(world: World, ctx: SystemContext, attacker: Entity, damage: number): number {
  const health = world.tryGet(attacker, Health);
  if (health !== undefined && health.hitpoints <= 0) return damage;
  let dealt = damage;
  const dealtPct = carriedEffect(world, ctx.content, attacker, 'damageDealtPct');
  if (dealtPct !== undefined) dealt = Math.floor((dealt * dealtPct) / PERCENT);
  const critical = carriedEffect(world, ctx.content, attacker, 'criticalHit');
  if (critical !== undefined && ctx.rng.int(PERCENT) < critical.chancePct) {
    dealt = Math.floor((dealt * critical.damagePct) / PERCENT);
  }
  return dealt;
}

/** The share of a blow's damage its target takes. Original behavior: the defense amulet halves it,
 *  truncating, after the striker's effects. */
export function damageTakenBy(world: World, ctx: SystemContext, target: Entity, damage: number): number {
  const takenPct = carriedEffect(world, ctx.content, target, 'damageTakenPct');
  return takenPct === undefined ? damage : Math.trunc((damage * takenPct) / PERCENT);
}

/** Ticks `e`'s carried items take off each walked step (the speed amulet's 2). */
export function carriedStepTicksSaved(world: World, content: ContentSet, e: Entity): number {
  return carriedEffect(world, content, e, 'walkStepTicksSaved') ?? 0;
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
  return liveEquipOf(ctx.content, tool)?.productionBonusPct ?? 0;
}

/** The work factor of bare hands, in percent: what a worker with no live tool works at. */
export const BARE_HANDS_WORK_FACTOR_PCT = 100;

/** A worker's tool work factor in percent for strokes and build swings (the schema's `workFactorPct`):
 *  bare hands for a no/spent tool or an unrated good. */
export function toolWorkFactorPct(world: World, ctx: SystemContext, worker: Entity): number {
  const tool = world.tryGet(worker, Equipment)?.tool ?? null;
  return liveEquipOf(ctx.content, tool)?.workFactorPct ?? BARE_HANDS_WORK_FACTOR_PCT;
}
