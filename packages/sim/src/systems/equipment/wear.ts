import type { EquipCategory } from '@open-northland/data';
import {
  bootsDegreeOfUse,
  Equipment,
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  PathFollow,
  wornSlot,
  writeEquipSlot,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { type Fixed, fx, ONE, ZERO } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';

// Equipment wear: a wearing item spends its content-rated `equip.uses` in equal steps (one work event for
// tools, one sip for consumables) and breaks at ONE, so the slot clears and the unit leaves the
// economy. Boots spend theirs at each walked node, including the terminal destination.

/** One use's wear step for `goodType`: `divCeil(ONE, uses)`, so an item never outlives its rating
 *  (truncation would give a 5-use bottle a 6th sip). ZERO for a non-wearing or unrated good. */
export function wearStepOf(ctx: SystemContext, goodType: number): Fixed {
  const equip = contentIndex(ctx.content).goods.get(goodType)?.equip;
  if (equip === undefined || !equip.wears || equip.uses === undefined) return ZERO;
  return fx.divCeil(ONE, fx.fromInt(equip.uses));
}

/** The whole rated uses a slot's `degreeOfUse` stands for. At ratings <= ONE/2, truncation loses less
 *  than half a use, so nearest-integer recovery of {@link usesToDegree} is lossless. */
function degreeToUses(degreeOfUse: Fixed, uses: number): number {
  const half = fx.div(ONE, fx.fromInt(2));
  return fx.toInt(fx.add(fx.mulDiv(degreeOfUse, fx.fromInt(uses), ONE), half));
}

/** The `degreeOfUse` of `spent` of `uses` rated uses. */
function usesToDegree(spent: number, uses: number): Fixed {
  return fx.div(fx.fromInt(spent), fx.fromInt(uses));
}

/**
 * Advance the addressed worn slot's `degreeOfUse` by `step`; reaching ONE breaks the item, so the slot
 * clears and the unit leaves the economy. No-op for an empty slot, a ZERO step, or an already spent unit.
 */
export function applyEquipWear(
  world: World,
  entity: Entity,
  group: EquipCategory,
  slot: number,
  step: Fixed,
): void {
  if (step <= ZERO) return;
  const worn = wornSlot(world, entity, group, slot);
  if (worn === null || worn.degreeOfUse >= ONE) return;
  wearSlotTo(world, entity, group, slot, worn.goodType, fx.add(worn.degreeOfUse, step));
}

/** Store a worn slot's new degree of use, breaking the item at ONE. A walking pair keeps its step wear
 *  in the walk's {@link PathFollow}, so a step leaves the equipment record unwritten. */
function wearSlotTo(
  world: World,
  e: Entity,
  group: EquipCategory,
  slot: number,
  goodType: number,
  used: Fixed,
): void {
  if (used >= ONE) {
    writeEquipSlot(world, e, group, slot, null);
    return;
  }
  const walk = group === 'boots' ? world.tryMut(e, PathFollow) : undefined;
  if (walk !== undefined) walk.bootsDegree = used;
  else writeEquipSlot(world, e, group, slot, { goodType, degreeOfUse: used });
}

/**
 * The wear of one step off a node of `roughness`, doubled while hauling a good, on the walker's boots. The
 * original keeps a pair's condition as whole points, the good's rated `uses` (10000, the original's
 * shoe maximum), and takes `roughness << carrying` off it every time a human
 * starts a step or reaches the terminal destination; the pair is gone at zero. The slot's fraction
 * recovers these counts exactly for the original 10000-point rating.
 */
export function wearWornBoots(
  world: World,
  ctx: SystemContext,
  e: Entity,
  roughness: number,
  carrying: boolean,
): void {
  if (hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.SHOES_DO_NOT_WEAR)) return;
  const boots = world.tryGet(e, Equipment)?.boots;
  const degreeOfUse = bootsDegreeOfUse(world, e);
  if (boots == null || degreeOfUse === null || degreeOfUse >= ONE) return;
  const equip = contentIndex(ctx.content).goods.get(boots.goodType)?.equip;
  if (equip === undefined || !equip.wears || equip.uses === undefined) return;
  const wear = carrying ? roughness * CARRYING_WEAR_FACTOR : roughness;
  if (wear === 0) return;
  // Authored ratings beyond the lossless count range use the same rounded-up fractional wear as tools.
  // Otherwise a sub-ULP point can round back to zero forever and make the pair indestructible.
  if (equip.uses > ONE / 2) {
    applyEquipWear(world, e, 'boots', 0, fx.divCeil(fx.fromInt(wear), fx.fromInt(equip.uses)));
    return;
  }
  const spent = degreeToUses(degreeOfUse, equip.uses) + wear;
  wearSlotTo(
    world,
    e,
    'boots',
    0,
    boots.goodType,
    spent >= equip.uses ? ONE : usesToDegree(spent, equip.uses),
  );
}

/** A hauled good doubles each step's boot wear (`roughness << 1`). */
const CARRYING_WEAR_FACTOR = 2;

/** One work event's tool wear: a completed production cycle, a gathering stroke, a cast, a build swing or
 *  a watering, whether or not the event paid off. Original behavior. */
export function wearWornTool(world: World, ctx: SystemContext, operator: Entity): void {
  const tool = world.tryGet(operator, Equipment)?.tool;
  if (tool == null) return;
  applyEquipWear(world, operator, 'tool', 0, wearStepOf(ctx, tool.goodType));
}
