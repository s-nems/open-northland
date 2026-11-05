import {
  ASSISTANT_ARMING_INTENTS,
  ASSISTANT_COUNTER_MAX,
  ASSISTANT_COUNTER_MIN,
  AssistantArmorOrders,
  AssistantCivilianOnlyGrants,
  type AssistantCounterKind,
  AssistantCounters,
  AssistantGrants,
  AssistantMovesFlags,
  AssistantPostsGraduates,
  AssistantSoldierOnlyGrants,
  type AssistantSwitch,
  AssistantUpgradesTools,
  AssistantWeaponOrders,
  AssistantWeaponVetoes,
  assistantArmorOrdersEntity,
  assistantCountersAtDefault,
  assistantCountersEntity,
  assistantSwitchEntity,
  assistantWeaponOrdersEntity,
  defaultAssistantCounters,
  INFINITE_COUNTER_KINDS,
  type PlayerGoodList,
  playerGoodListEntity,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { armorGoodsByProtection, weaponGoodsByStrength } from '../readviews/index.js';
import { INTENT_WEAPON_CLASS } from '../settlers/atomics/effects/goods/weapon-class.js';

/**
 * Toggle one good in `player`'s assistant grant list - see the command doc. The carrier lifecycle is
 * {@link setListed}'s.
 */
export function setAssistantGrant(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setAssistantGrant' }>,
): void {
  const good = contentIndex(ctx.content).goods.get(command.goodType);
  if (good?.equip === undefined) return; // only a wearable good is grantable
  setListed(world, AssistantGrants, command.player, command.goodType, command.enabled);
}

/** Revoke `goods` from `player`'s grant list, the strategic AI's teardown seam for the goods it published. */
export function revokeAssistantGrants(world: World, player: number, goods: readonly number[]): void {
  for (const good of goods) setListed(world, AssistantGrants, player, good, false);
}

/** Keep one carried good for `player`'s fighters or civilians alone, or lift the limit - see the command
 *  doc. The carrier lifecycle is {@link setListed}'s. */
export function setAssistantGrantAudience(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setAssistantGrantAudience' }>,
): void {
  const good = contentIndex(ctx.content).goods.get(command.goodType);
  if (good?.equip?.category !== 'misc') return; // boots and tools go to everyone the pass dresses
  const { player, goodType, audience } = command;
  setListed(world, AssistantSoldierOnlyGrants, player, goodType, audience === 'soldiers');
  setListed(world, AssistantCivilianOnlyGrants, player, goodType, audience === 'civilians');
}

/** Lift the soldiers-only limit of `goods` for `player`, the strategic AI's teardown seam. */
export function liftAssistantSoldiersOnly(world: World, player: number, goods: readonly number[]): void {
  for (const good of goods) setListed(world, AssistantSoldierOnlyGrants, player, good, false);
}

/** Switch `player`'s graduate posting on or off - see the command doc. */
export function setAssistantPostGraduates(
  world: World,
  command: Extract<Command, { kind: 'setAssistantPostGraduates' }>,
): void {
  setAssistantSwitch(world, AssistantPostsGraduates, command.player, command.enabled);
}

/** Switch whether `player`'s gatherers move their own flags - see the command doc. */
export function setAssistantMoveFlags(
  world: World,
  command: Extract<Command, { kind: 'setAssistantMoveFlags' }>,
): void {
  setAssistantSwitch(world, AssistantMovesFlags, command.player, command.enabled);
}

/** Switch whether `player`'s workers swap their tools for better ones - see the command doc. */
export function setAssistantUpgradeTools(
  world: World,
  command: Extract<Command, { kind: 'setAssistantUpgradeTools' }>,
): void {
  setAssistantSwitch(world, AssistantUpgradesTools, command.player, command.enabled);
}

/** Turn `player`'s `toggle` on or off: the carrier exists while it is on. */
export function setAssistantSwitch(
  world: World,
  toggle: AssistantSwitch,
  player: number,
  enabled: boolean,
): void {
  const carrier = assistantSwitchEntity(world, toggle, player);
  if (enabled && carrier === null) world.add(world.create(), toggle, { player });
  else if (!enabled && carrier !== null) world.destroy(carrier);
}

/** Veto or allow one weapon good in `player`'s recruit arming - see the command doc. */
export function setAssistantWeaponVeto(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setAssistantWeaponVeto' }>,
): void {
  if (!ctx.content.weapons.some((w) => w.goodType === command.goodType)) return; // arms no class
  setListed(world, AssistantWeaponVetoes, command.player, command.goodType, command.vetoed);
}

/** Set one weapon class's armor choice for `player` - see the command doc. A choice equal to the
 *  default drops the class's entry, and the carrier goes with the last entry. */
export function setAssistantArmorOrder(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setAssistantArmorOrder' }>,
): void {
  const goods = armorGoodsByProtection(ctx.content);
  const { player, intent, order, off } = command;
  if (!isPermutationOf(order, goods) || !off.every((good) => order.includes(good))) return;
  const offOnce = [...new Set(off)].sort((a, b) => a - b);
  const atDefault = offOnce.length === 0 && order.every((good, i) => good === goods[i]);
  const carrier = assistantArmorOrdersEntity(world, player);
  if (atDefault) {
    if (carrier === null || world.get(carrier, AssistantArmorOrders)[intent] === undefined) return;
    const block = world.mut(carrier, AssistantArmorOrders);
    block[intent] = undefined;
    if (ASSISTANT_ARMING_INTENTS.every((kind) => block[kind] === undefined)) world.destroy(carrier);
    return;
  }
  const choice = { order: [...order], off: offOnce };
  if (carrier === null) world.add(world.create(), AssistantArmorOrders, { player, [intent]: choice });
  else world.mut(carrier, AssistantArmorOrders)[intent] = choice;
}

/** Set one weapon class's weapon order for `player` - see the command doc. The default order drops the
 *  class's entry, and the carrier goes with the last entry. */
export function setAssistantWeaponOrder(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setAssistantWeaponOrder' }>,
): void {
  const { player, intent, order } = command;
  const goods = weaponGoodsByStrength(ctx.content, INTENT_WEAPON_CLASS[intent]);
  if (!isPermutationOf(order, goods)) return;
  const carrier = assistantWeaponOrdersEntity(world, player);
  if (order.every((good, i) => good === goods[i])) {
    if (carrier === null || world.get(carrier, AssistantWeaponOrders)[intent] === undefined) return;
    const block = world.mut(carrier, AssistantWeaponOrders);
    block[intent] = undefined;
    if (ASSISTANT_ARMING_INTENTS.every((kind) => block[kind] === undefined)) world.destroy(carrier);
    return;
  }
  if (carrier === null) world.add(world.create(), AssistantWeaponOrders, { player, [intent]: [...order] });
  else world.mut(carrier, AssistantWeaponOrders)[intent] = [...order];
}

/** Whether `order` holds every one of `goods` once and nothing else. */
function isPermutationOf(order: readonly number[], goods: readonly number[]): boolean {
  return order.length === goods.length && goods.every((good) => order.includes(good));
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
  // A typed producer skips the payload parser, and a non-finite value would escape the clamp.
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
