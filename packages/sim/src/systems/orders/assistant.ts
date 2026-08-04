import {
  ASSISTANT_COUNTER_KINDS,
  ASSISTANT_COUNTER_MAX,
  ASSISTANT_COUNTER_MIN,
  type AssistantCounterKind,
  AssistantCounters,
  AssistantGrants,
  assistantCountersAtDefault,
  assistantCountersEntity,
  assistantGrantsEntity,
  defaultAssistantCounters,
  INFINITE_COUNTER_KINDS,
  isValidPlayer,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';

/**
 * Toggle one good in `player`'s assistant grant list - see the command doc. Owns the rules-singleton
 * carrier lifecycle stated on {@link AssistantGrants}.
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

/**
 * Set one assistant production counter to an absolute state - see the command doc. Owns the
 * rules-singleton carrier lifecycle stated on {@link AssistantCounters}.
 */
export function setAssistantCounter(
  world: World,
  _ctx: SystemContext,
  command: Extract<Command, { kind: 'setAssistantCounter' }>,
): void {
  if (!isValidPlayer(command.player)) return;
  // A replayed/hand-built command can carry any JSON: an unknown kind would write a key the default
  // check never inspects, and a non-finite value escapes the clamp. Both are recoverable bad input.
  if (!(ASSISTANT_COUNTER_KINDS as readonly string[]).includes(command.counter)) return;
  if (!Number.isFinite(command.value)) return;
  const value = Math.min(ASSISTANT_COUNTER_MAX, Math.max(ASSISTANT_COUNTER_MIN, Math.trunc(command.value)));
  const infinite = command.infinite && INFINITE_COUNTER_KINDS.has(command.counter);
  const carrier = assistantCountersEntity(world, command.player);
  if (carrier === null) {
    if (value === 0 && !infinite) return; // already at the default - no carrier to make
    const counters = defaultAssistantCounters();
    counters[command.counter] = { value, infinite };
    world.add(world.create(), AssistantCounters, { player: command.player, counters });
    return;
  }
  const block = world.get(carrier, AssistantCounters);
  block.counters[command.counter] = { value, infinite };
  if (assistantCountersAtDefault(block.counters)) world.destroy(carrier);
}

/**
 * Reset `kinds` of `player`'s counters to zero and finite, the strategic AI's teardown seam: a detached
 * module's standing queues stop while counters another hand set survive. Destroys the carrier at
 * all-default like any write.
 */
export function resetAssistantCounters(
  world: World,
  player: number,
  kinds: readonly AssistantCounterKind[],
): void {
  const carrier = assistantCountersEntity(world, player);
  if (carrier === null) return;
  const block = world.get(carrier, AssistantCounters);
  for (const kind of kinds) block.counters[kind] = { value: 0, infinite: false };
  if (assistantCountersAtDefault(block.counters)) world.destroy(carrier);
}
