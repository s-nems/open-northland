import type { ContentSet, EquipClass } from '@open-northland/data';
import {
  Equipment,
  type EquipmentData,
  type EquipmentSlot,
  Health,
  Settler,
} from '../../components/index.js';
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

/** A permanent equipped hunger restore makes an ordered meal unnecessary. */
export function carriesFoodAmulet(world: World, content: ContentSet, e: Entity): boolean {
  return (world.tryGet(e, Equipment)?.misc ?? []).some((slot) => {
    const equip = liveEquipOf(content, slot);
    return !equip?.wears && (equip?.restorePct?.hunger ?? 0) > 0;
  });
}

type CarriedEffect = 'damageDealtPct' | 'criticalHit' | 'damageTakenPct' | 'walkStepTicksSaved';

/** A carried effect of `e`'s misc row: the first live slot's value, so a second copy adds nothing. */
function carriedEffect<K extends CarriedEffect>(
  world: World,
  content: ContentSet,
  e: Entity,
  effect: K,
  equipment: Readonly<EquipmentData> | undefined = world.tryGet(e, Equipment),
): EquipClass[K] | undefined {
  const misc = equipment?.misc;
  if (misc === undefined) return undefined;
  // Indexed: each walker's leg start reads this, and a for-of hands out an iterator result per slot.
  for (let i = 0; i < misc.length; i++) {
    const value = liveEquipOf(content, misc[i])?.[effect];
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
  if (dealtPct !== undefined) dealt = scaledDealtDamage(dealt, dealtPct);
  const critical = carriedEffect(world, ctx.content, attacker, 'criticalHit');
  if (critical !== undefined && ctx.rng.int(PERCENT) < critical.chancePct) {
    dealt = Math.floor((dealt * critical.damagePct) / PERCENT);
  }
  return dealt;
}

/** `damage` raised by a striker's `damageDealtPct`, rounding down. */
export function scaledDealtDamage(damage: number, dealtPct: number): number {
  return Math.floor((damage * dealtPct) / PERCENT);
}

/** `damage` cut by a target's `damageTakenPct`, truncating. */
export function scaledTakenDamage(damage: number, takenPct: number): number {
  return Math.trunc((damage * takenPct) / PERCENT);
}

/** The share of a blow's damage its target takes. Original behavior: the defense amulet halves it,
 *  truncating, after the striker's effects. */
export function damageTakenBy(world: World, ctx: SystemContext, target: Entity, damage: number): number {
  const takenPct = carriedEffect(world, ctx.content, target, 'damageTakenPct');
  return takenPct === undefined ? damage : scaledTakenDamage(damage, takenPct);
}

/** The fight effects `e`'s misc row carries, each as {@link damageDealtBy} and {@link damageTakenBy} read
 *  them: absent when no live slot grants it. */
export interface CarriedCombatEffects {
  readonly damageDealtPct: number | undefined;
  readonly criticalHit: EquipClass['criticalHit'];
  readonly damageTakenPct: number | undefined;
}

export function carriedCombatEffects(world: World, content: ContentSet, e: Entity): CarriedCombatEffects {
  let damageDealtPct: number | undefined;
  let criticalHit: EquipClass['criticalHit'];
  let damageTakenPct: number | undefined;
  for (const held of world.tryGet(e, Equipment)?.misc ?? []) {
    const equip = liveEquipOf(content, held);
    if (equip === undefined) continue;
    damageDealtPct ??= equip.damageDealtPct;
    criticalHit ??= equip.criticalHit;
    damageTakenPct ??= equip.damageTakenPct;
  }
  return { damageDealtPct, criticalHit, damageTakenPct };
}

/** The hitpoints the healing potions in `e`'s misc row still hold: each live slot's sip of its bearer's
 *  `max` times the sips left, rounded up as a part-used potion still gives a whole sip. */
export function healingReserveOf(world: World, content: ContentSet, e: Entity, max: number): number {
  let reserve = 0;
  for (const slot of world.tryGet(e, Equipment)?.misc ?? []) {
    const equip = liveEquipOf(content, slot);
    const sip = equip?.restorePct?.healthMax;
    if (slot == null || equip?.uses === undefined || sip === undefined) continue;
    const sipsLeft = Math.ceil((equip.uses * (ONE - slot.degreeOfUse)) / ONE);
    reserve += Math.floor((max * sip) / PERCENT) * sipsLeft;
  }
  return reserve;
}

/** Ticks `e`'s carried items take off each walked step (the speed amulet's 2). `equipment` is `e`'s
 *  {@link Equipment} for a caller that already read it. */
export function carriedStepTicksSaved(
  world: World,
  content: ContentSet,
  e: Entity,
  equipment: Readonly<EquipmentData> | undefined = world.tryGet(e, Equipment),
): number {
  return carriedEffect(world, content, e, 'walkStepTicksSaved', equipment) ?? 0;
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
