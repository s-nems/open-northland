import { Equipment, Health, Settler } from '../../../components/index.js';
import { ONE } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { applyEquipWear, draughtRestores, wearStepOf } from '../../equipment/index.js';
import { relieveNeed } from '../../lifecycle/needs.js';

/**
 * Apply one completed `drink`: re-read misc[`slot`] - a slot emptied or spent since the drive chose
 * it whiffs (unlike `eat`'s raced store, the bottle is the SOLE source, so nothing restores from a
 * bare slot). Otherwise apply ALL the good's content restores - hunger/fatigue via
 * {@link relieveNeed}, health capped at max - then advance the bottle one sip; the last rated sip
 * vanishes it from the slot (manual: "Small potions can be used twice ... Then they are used up").
 */
export function drinkDraught(world: World, ctx: SystemContext, settler: Entity, slot: number): void {
  const eq = world.tryGet(settler, Equipment);
  const held = eq?.misc[slot] ?? null;
  if (held === null || held.degreeOfUse >= ONE) return;
  const restores = draughtRestores(ctx, held.goodType);
  const s = world.tryGet(settler, Settler);
  if (s !== undefined) {
    if (restores.hunger !== undefined) s.hunger = relieveNeed(s.hunger, restores.hunger);
    if (restores.fatigue !== undefined) s.fatigue = relieveNeed(s.fatigue, restores.fatigue);
  }
  if (restores.healthMaxPct !== undefined) {
    const health = world.tryGet(settler, Health);
    if (health !== undefined) {
      health.hitpoints = Math.min(
        health.max,
        health.hitpoints + Math.trunc((health.max * restores.healthMaxPct) / 100),
      );
    }
  }
  world.touch(settler); // needs/health written in place (the sip below may whiff on an unrated good)
  applyEquipWear(world, settler, 'misc', slot, wearStepOf(ctx, held.goodType));
}
