import type { EquipCategory } from '@open-northland/data';
import { Equipment, equipSlotValue, writeEquipSlot } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { type Fixed, fx, ONE, ZERO } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';

// Equipment wear: a wearing item spends its content-rated `equip.uses` in equal steps (one walked
// waypoint for boots, one production cycle for tools, one sip for consumables) and BREAKS at ONE -
// the slot clears and the unit leaves the economy. Provenance of the ratings lives on the schema's
// `uses` field and the catalog constants.

/** One use's wear step for `goodType`: `divCeil(ONE, uses)`, so an item never outlives its rating
 *  (truncation would give a 5-use bottle a 6th sip). ZERO for a non-wearing or unrated good. */
export function wearStepOf(ctx: SystemContext, goodType: number): Fixed {
  const equip = contentIndex(ctx.content).goods.get(goodType)?.equip;
  if (equip === undefined || !equip.wears || equip.uses === undefined) return ZERO;
  return fx.divCeil(ONE, fx.fromInt(equip.uses));
}

/**
 * Advance the addressed worn slot's `degreeOfUse` by `step`; reaching ONE breaks the item - the slot
 * clears and the unit is gone (deliberate sink, like the destroy-used rule - see
 * `settlers/effects-goods/equip.ts`). No-op for an empty slot, a ZERO step, or an already-spent unit
 * (a scene can stamp one at 100%).
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
  writeEquipSlot(eq, group, slot, used >= ONE ? null : { goodType: worn.goodType, degreeOfUse: used });
  world.touch(entity); // log the in-place write (the direct-field-write convention; cheap Set.add)
}

/** One walked waypoint's boots wear (the movement system's per-arrival hook). */
export function wearWornBoots(world: World, ctx: SystemContext, e: Entity): void {
  const boots = world.tryGet(e, Equipment)?.boots;
  if (boots == null) return;
  applyEquipWear(world, e, 'boots', 0, wearStepOf(ctx, boots.goodType));
}

/** One completed production cycle's tool wear (the bonus-output hook). */
export function wearWornTool(world: World, ctx: SystemContext, operator: Entity): void {
  const tool = world.tryGet(operator, Equipment)?.tool;
  if (tool == null) return;
  applyEquipWear(world, operator, 'tool', 0, wearStepOf(ctx, tool.goodType));
}
