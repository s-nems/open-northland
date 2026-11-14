import {
  ASSISTANT_GRANT_GROUPS,
  assistantGrantedGoods,
  assistantWithheldGoods,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { World } from '../../../ecs/world.js';
import { goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import type { SystemContext } from '../../context.js';

/** The goods the seat hands every settler through the assistant, one slot each as a store holds a unit.
 *  Owner ruling: the vikings live on mead, so bread goes to the children, and boots and tools speed every
 *  trade up; mead goes to every group of men, civilians included. The assistant gives a tool only to a
 *  trade that works with one. */
export const SETTLEMENT_GRANT_GOOD_IDS: readonly string[] = ['mead', 'shoes', 'tool_iron', 'tool_wooden'];

/** The good types of {@link SETTLEMENT_GRANT_GOOD_IDS} that are wearables in this content set. */
export function settlementGrantGoods(ctx: SystemContext): number[] {
  const goods: number[] = [];
  for (const id of SETTLEMENT_GRANT_GOOD_IDS) {
    const good = goodTypeByContentId(ctx.content, id);
    if (good?.equip !== undefined) goods.push(good.typeId);
  }
  return goods;
}

/** The commands granting the settlement goods to every group of men until they are: the same hand-out a
 *  player switches on, whose pass then sends a settler with a free slot to the store for one. A group the
 *  seat's assistant withholds one from, as a hand that played the seat before may have left it, is opened
 *  again before the grant. */
export function settlementGrantOrders(world: World, ctx: SystemContext, player: number): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  const granted = assistantGrantedGoods(world, player);
  const withheld = ASSISTANT_GRANT_GROUPS.map((group) => assistantWithheldGoods(world, player, group));
  for (const goodType of settlementGrantGoods(ctx)) {
    if (withheld.some((goods) => goods.includes(goodType))) {
      commands.push({
        kind: 'setAssistantGrantAudience',
        player,
        goodType,
        groups: [...ASSISTANT_GRANT_GROUPS],
      });
    }
    if (!granted.includes(goodType))
      commands.push({ kind: 'setAssistantGrant', player, goodType, enabled: true });
  }
  return commands;
}
