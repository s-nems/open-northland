import { assistantGrantedGoods, assistantSoldierOnlyGoods } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { World } from '../../../ecs/world.js';
import { goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import type { SystemContext } from '../../context.js';

/** The misc goods the seat grants its soldiers through the assistant, one slot each as a store holds a
 *  unit. Owner ruling: the healing potions and every amulet go to the soldiers alone. The small potion is
 *  granted with the big one, as the player's healing switch does, so a watched seat's window reads the
 *  switch as on. */
export const SOLDIER_OUTFIT_GOOD_IDS: readonly string[] = [
  'potion_heal_big',
  'potion_heal_small',
  'amulet_defense',
  'amulet_strength',
  'amulet_food',
  'amulet_stamina',
  'amulet_crithit',
  'amulet_speed',
];

/** The good types of {@link SOLDIER_OUTFIT_GOOD_IDS} that are wearables in this content set. */
export function soldierOutfitGoods(ctx: SystemContext): number[] {
  const goods: number[] = [];
  for (const id of SOLDIER_OUTFIT_GOOD_IDS) {
    const good = goodTypeByContentId(ctx.content, id);
    if (good?.equip !== undefined) goods.push(good.typeId);
  }
  return goods;
}

/**
 * The commands putting the seat's soldier outfit on the assistant until it is there: each outfit good kept
 * for soldiers alone and granted, the limit before the grant so no civilian is dressed in the tick
 * between. The same hand-out a player switches on; the assistant's own pass then dresses the seat's
 * fighters wherever they stand.
 */
export function outfitGrantOrders(world: World, ctx: SystemContext, player: number): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  const limited = assistantSoldierOnlyGoods(world, player);
  const granted = assistantGrantedGoods(world, player);
  for (const goodType of soldierOutfitGoods(ctx)) {
    if (!limited.includes(goodType))
      commands.push({ kind: 'setAssistantGrantAudience', player, goodType, audience: 'soldiers' });
    if (!granted.includes(goodType))
      commands.push({ kind: 'setAssistantGrant', player, goodType, enabled: true });
  }
  return commands;
}
