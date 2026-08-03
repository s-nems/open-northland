import { Equipment, Health, Settler } from '../../../../../components/index.js';
import { ONE } from '../../../../../core/fixed.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import type { SystemContext } from '../../../../context.js';
import { applyEquipWear, draughtRestores, wearStepOf } from '../../../../equipment/index.js';
import { relieveNeed } from '../../../../lifecycle/needs.js';

/**
 * Apply one completed `drink`: a slot emptied or spent since the drive chose it restores nothing, since
 * the bottle is the sole source. Otherwise apply the good's hunger, fatigue, and health restores, then
 * advance the bottle one sip; the last rated sip vanishes it from the slot (manual: "Small potions can be
 * used twice ... Then they are used up").
 */
export function drinkDraught(world: World, ctx: SystemContext, settler: Entity, slot: number): void {
  const eq = world.tryGet(settler, Equipment);
  const held = eq?.misc[slot] ?? null;
  if (held === null || held.degreeOfUse >= ONE) return;
  const { hunger, fatigue, healthMaxPct } = draughtRestores(ctx, held.goodType);
  if ((hunger !== undefined || fatigue !== undefined) && world.has(settler, Settler)) {
    world.write(settler, Settler, (s) => {
      if (hunger !== undefined) s.hunger = relieveNeed(s.hunger, hunger);
      if (fatigue !== undefined) s.fatigue = relieveNeed(s.fatigue, fatigue);
    });
  }
  if (healthMaxPct !== undefined && world.has(settler, Health)) {
    world.write(settler, Health, (h) => {
      h.hitpoints = Math.min(h.max, h.hitpoints + Math.trunc((h.max * healthMaxPct) / 100));
    });
  }
  applyEquipWear(world, settler, 'misc', slot, wearStepOf(ctx, held.goodType));
}
