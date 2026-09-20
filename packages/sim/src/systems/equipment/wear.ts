import type { EquipCategory } from '@open-northland/data';
import { Equipment, equipSlotValue, writeEquipSlot } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { type Fixed, fx, ONE, ZERO } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';

// Equipment wear: a wearing item spends its content-rated `equip.uses` in equal steps (one production cycle
// for tools, one sip for consumables) and breaks at ONE, so the slot clears and the unit leaves the
// economy. Boots spend theirs by the roughness of every node they leave.

/** One use's wear step for `goodType`: `divCeil(ONE, uses)`, so an item never outlives its rating
 *  (truncation would give a 5-use bottle a 6th sip). ZERO for a non-wearing or unrated good. */
export function wearStepOf(ctx: SystemContext, goodType: number): Fixed {
  const equip = contentIndex(ctx.content).goods.get(goodType)?.equip;
  if (equip === undefined || !equip.wears || equip.uses === undefined) return ZERO;
  return fx.divCeil(ONE, fx.fromInt(equip.uses));
}

/** The whole rated uses a slot's `degreeOfUse` stands for, recovered exactly: {@link usesToDegree} spaces
 *  consecutive counts at least six ulps apart for any rating under ONE/2, so rounding back is lossless. */
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
  const eq = world.tryGet(entity, Equipment);
  if (eq === undefined) return;
  const worn = equipSlotValue(eq, group, slot);
  if (worn === null || worn.degreeOfUse >= ONE) return;
  const used = fx.add(worn.degreeOfUse, step);
  writeEquipSlot(
    world.mut(entity, Equipment),
    group,
    slot,
    used >= ONE ? null : { goodType: worn.goodType, degreeOfUse: used },
  );
}

/**
 * The wear of one step off a node of `roughness`, doubled while hauling a good, on the walker's boots. The
 * original keeps a pair's condition as whole points, the good's rated `uses` (10000, byte-verified
 * `cHumanInventoryMaximumCondition_Shoe`), and takes `roughness << carrying` off it every time a human
 * leaves a node; the pair is gone at zero. The slot's fraction is that count in the shared `degreeOfUse`
 * scale, converted both ways without loss so the pair lasts exactly its points.
 */
export function wearWornBoots(
  world: World,
  ctx: SystemContext,
  e: Entity,
  roughness: number,
  carrying: boolean,
): void {
  const boots = world.tryGet(e, Equipment)?.boots;
  if (boots == null || boots.degreeOfUse >= ONE) return;
  const equip = contentIndex(ctx.content).goods.get(boots.goodType)?.equip;
  if (equip === undefined || !equip.wears || equip.uses === undefined) return;
  const wear = carrying ? roughness * CARRYING_WEAR_FACTOR : roughness;
  if (wear === 0) return;
  const spent = degreeToUses(boots.degreeOfUse, equip.uses) + wear;
  writeEquipSlot(
    world.mut(e, Equipment),
    'boots',
    0,
    spent >= equip.uses ? null : { goodType: boots.goodType, degreeOfUse: usesToDegree(spent, equip.uses) },
  );
}

/** A hauled good doubles each step's boot wear (`roughness << 1`). */
const CARRYING_WEAR_FACTOR = 2;

/** One completed production cycle's tool wear (the bonus-output hook). */
export function wearWornTool(world: World, ctx: SystemContext, operator: Entity): void {
  const tool = world.tryGet(operator, Equipment)?.tool;
  if (tool == null) return;
  applyEquipWear(world, operator, 'tool', 0, wearStepOf(ctx, tool.goodType));
}
