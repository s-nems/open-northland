import type { EquipCategory } from '@open-northland/data';
import type { Fixed } from '../core/fixed.js';
import { defineComponent, type Entity, type World } from '../ecs/world.js';
import type { NodeId } from '../nav/terrain/index.js';
import { PathFollow } from './movement.js';

/**
 * How many "misc" consumable slots (mead / potions / amulets) a character carries. Approximation: the
 * categories are source-pinned (see {@link Equipment}), but no readable data carries the slot counts.
 */
export const MISC_EQUIP_SLOTS = 4;

/**
 * One occupied equipment slot. `goodType` is the equip good's `typeId` (the original's equippable ids
 * 30-55); `degreeOfUse` is the original's "degree of use" as a {@link Fixed} fraction in `[0, ONE]`, `ONE`
 * meaning spent, held at `0` for a good whose `equip.wears` is false (manual: "Unused items ... can be
 * used again").
 */
export interface EquipmentSlot {
  readonly goodType: number;
  readonly degreeOfUse: Fixed;
}

/**
 * A character's worn equipment - the player-facing inventory the original's equip window shows, its slot
 * kinds source-pinned to the manual's Equipment section.
 *
 * This is the inventory/display axis, distinct from the combat {@link Weapon}/{@link Armor} components.
 * Only the armor half is wired: a worn `armor` good overrides a stamped {@link Armor} tier at damage
 * resolution.
 */
export interface EquipmentData {
  boots: EquipmentSlot | null;
  tool: EquipmentSlot | null;
  weapon: EquipmentSlot | null;
  armor: EquipmentSlot | null;
  misc: ReadonlyArray<EquipmentSlot | null>;
}

export const Equipment = defineComponent<EquipmentData>('Equipment', 'settlers');

/** The good stored in one addressed equipment slot, or null when the slot is empty / out of range. Boots
 *  read here miss the wear of a walk under way; use {@link wornSlot} for a slot's condition. */
export function equipSlotValue(eq: EquipmentData, group: EquipCategory, slot: number): EquipmentSlot | null {
  if (group === 'misc') return eq.misc[slot] ?? null;
  return eq[group];
}

/** The degree of use of the boots `e` wears now, or null when it wears none. */
export function bootsDegreeOfUse(world: World, e: Entity): Fixed | null {
  const boots = world.tryGet(e, Equipment)?.boots ?? null;
  if (boots === null) return null;
  return world.tryGet(e, PathFollow)?.bootsDegree ?? boots.degreeOfUse;
}

/** The good worn in one addressed slot of `e` with its current degree of use, or null when empty. */
export function wornSlot(world: World, e: Entity, group: EquipCategory, slot: number): EquipmentSlot | null {
  const eq = world.tryGet(e, Equipment);
  const held = eq === undefined ? null : equipSlotValue(eq, group, slot);
  const walked = group === 'boots' ? world.tryGet(e, PathFollow)?.bootsDegree : undefined;
  if (held === null || walked === undefined) return held;
  return { goodType: held.goodType, degreeOfUse: walked };
}

/** Write one addressed slot of `e`'s equipment (the misc array is replaced, never mutated in place).
 *  Writing the boots slot replaces the wear a walk under way carried for the old pair. */
export function writeEquipSlot(
  world: World,
  e: Entity,
  group: EquipCategory,
  slot: number,
  value: EquipmentSlot | null,
): void {
  const eq = world.mut(e, Equipment);
  if (group === 'misc') {
    eq.misc = eq.misc.map((held, i) => (i === slot ? value : held));
    return;
  }
  eq[group] = value;
  if (group === 'boots' && world.tryGet(e, PathFollow)?.bootsDegree !== undefined) {
    world.mut(e, PathFollow).bootsDegree = undefined;
  }
}

/** Store the boots wear `e`'s walk carried in its {@link PathFollow} into `Equipment.boots`, as the walk's
 *  path is dropped. */
export function settleWalkWear(world: World, e: Entity): void {
  const walked = world.tryGet(e, PathFollow)?.bootsDegree;
  const boots = world.tryGet(e, Equipment)?.boots ?? null;
  if (walked === undefined || boots === null) return;
  world.mut(e, Equipment).boots = { goodType: boots.goodType, degreeOfUse: walked };
}

export interface EquipOrderIntent {
  group: EquipCategory;
  /** The misc row; 0 for every single-slot group. */
  slot: number;
  goodType: number | null;
  /** The node the settler stood on at issue, so the errand ends where it began (authored: the manual
   *  describes the window's item list, not how the settler fetches). Null ends it where the fetch or stow leaves the settler. */
  returnTo: NodeId | null;
}

/**
 * An equip errand in flight on a settler. Player orders for other slots wait in `queued`, preserving the
 * click order; another order for the active slot still replaces it. `settlers/drives/equip-order.ts` owns
 * the stage protocol.
 */
export const EquipOrder = defineComponent<
  EquipOrderIntent & {
    stage: 'acquire' | 'stow' | 'return';
    /** The player's click or one of the assistant's automatic hand-outs. Player orders set a carried load
     *  down mid-errand; automatic orders yield it. */
    issuer: 'player' | 'assistant-grant' | 'assistant-recruit';
    /** Later player intents for different slots, in click order. */
    queued: EquipOrderIntent[];
  }
>('EquipOrder', 'settlers');
