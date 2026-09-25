import {
  ASSISTANT_COUNTER_KINDS,
  ASSISTANT_COUNTER_MAX,
  ASSISTANT_COUNTER_MIN,
  type AssistantCounterKind,
  AssistantCounters,
  AssistantGrants,
  AssistantWeaponVetoes,
  assistantCountersAtDefault,
  assistantCountersEntity,
  defaultAssistantCounters,
  INFINITE_COUNTER_KINDS,
  isValidPlayer,
  type PlayerGoodList,
  playerGoodListEntity,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';

/**
 * Toggle one good in `player`'s assistant grant list - see the command doc. The carrier lifecycle is
 * {@link setListed}'s.
 */
export function setAssistantGrant(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setAssistantGrant' }>,
): void {
  if (!isValidPlayer(command.player)) return;
  const good = contentIndex(ctx.content).goods.get(command.goodType);
  if (good?.equip === undefined) return; // only a wearable good is grantable
  setListed(world, AssistantGrants, command.player, command.goodType, command.enabled);
}

/** Veto or allow one weapon good in `player`'s recruit arming - see the command doc. */
export function setAssistantWeaponVeto(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setAssistantWeaponVeto' }>,
): void {
  if (!isValidPlayer(command.player)) return;
  if (!ctx.content.weapons.some((w) => w.goodType === command.goodType)) return; // arms no class
  setListed(world, AssistantWeaponVetoes, command.player, command.goodType, command.vetoed);
}

/** Lift every recruit weapon veto of `player`: the list is back to the default, nothing vetoed. */
export function clearAssistantWeaponVetoes(world: World, player: number): void {
  const carrier = playerGoodListEntity(world, AssistantWeaponVetoes, player);
  if (carrier !== null) world.destroy(carrier);
}

/** Put `good` on or off `player`'s `list`: the carrier is created with the first good and destroyed with
 *  the last, and the goods stay ascending. */
function setListed(world: World, list: PlayerGoodList, player: number, good: number, listed: boolean): void {
  const carrier = playerGoodListEntity(world, list, player);
  const current = carrier === null ? [] : world.get(carrier, list).goods;
  if (listed === current.includes(good)) return; // already in the wanted state
  if (!listed) {
    const goods = current.filter((g) => g !== good);
    if (carrier === null) return;
    if (goods.length === 0) world.destroy(carrier);
    else world.mut(carrier, list).goods = goods;
    return;
  }
  const goods = [...current, good].sort((a, b) => a - b);
  if (carrier === null) world.add(world.create(), list, { player, goods });
  else world.mut(carrier, list).goods = goods;
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
  const block = world.mut(carrier, AssistantCounters);
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
  const block = world.mut(carrier, AssistantCounters);
  for (const kind of kinds) block.counters[kind] = { value: 0, infinite: false };
  if (assistantCountersAtDefault(block.counters)) world.destroy(carrier);
}
