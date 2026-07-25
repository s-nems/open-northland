import { AssistantGrants, assistantGrantsEntity, isValidPlayer } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';

/**
 * Toggle one good in `player`'s assistant grant list - see the command doc. The carrier follows the
 * rules-singleton lifecycle: created on the first grant, updated in place, destroyed when the last
 * grant is revoked (so an all-off player hashes exactly like one that never touched the assistant).
 */
export function setAssistantGrant(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setAssistantGrant' }>,
): void {
  if (!isValidPlayer(command.player)) return;
  const good = contentIndex(ctx.content).goods.get(command.goodType);
  if (good?.equip === undefined) return; // only a wearable good is grantable
  const carrier = assistantGrantsEntity(world, command.player);
  const current = carrier === null ? [] : world.get(carrier, AssistantGrants).goods;
  if (command.enabled === current.includes(command.goodType)) return; // already in the wanted state
  if (!command.enabled) {
    const goods = current.filter((g) => g !== command.goodType);
    if (carrier === null) return;
    if (goods.length === 0) world.destroy(carrier);
    else world.get(carrier, AssistantGrants).goods = goods;
    return;
  }
  const goods = [...current, command.goodType].sort((a, b) => a - b);
  if (carrier === null) {
    world.add(world.create(), AssistantGrants, { player: command.player, goods });
  } else {
    world.get(carrier, AssistantGrants).goods = goods;
  }
}
