import {
  AssistantRecruit,
  assistantGrantedGoods,
  assistantSoldierOnlyGoods,
  Building,
  Equipment,
  storePriorityGoods,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { goodTypeByContentId } from '../../ai-shared/content-lookup.js';
import { spokenFor } from '../../ai-shared/military/errand.js';
import type { SystemContext } from '../../context.js';
import { armorGoodsByProtection, isBarracks, mayChangeEquipSlot } from '../../readviews/index.js';
import { EQUIP_FETCH_UNITS } from '../../settlers/atomics/effects/goods/index.js';
import { equipFetchesHeld } from '../../settlers/drives/equip-fetches.js';
import { type ReachableStock, reachableStock } from '../../settlers/planner/recruit-arming.js';
import { FetchableStock, interactionCell } from '../../settlers/targets/index.js';
import { networkLimitAt } from '../../signposts/index.js';
import { keepsStorePriority, stockCapacity } from '../../stores/index.js';
import { seatBarracksOf } from '../base.js';

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

/** The units of a good an errand can draw on. */
export type ReachableStockUnits = Pick<ReachableStock, 'units'>;

/**
 * The stock the seat's arming and dressing errands can fetch: what the stores reachable from its barracks
 * door lend ({@link reachableStock}), the reach its draft judges its classes from; null without a barracks
 * or a map. On magiczny_las three seats' bow recruits waited unarmed for over fifteen game minutes beside
 * a dozen vetoed short bows, while the seat stock counted six long bows none of them could reach, and
 * armed men stood undressed while their orders went for a plate lying on a heap past the network.
 */
export function seatArmsStock(world: World, ctx: SystemContext, player: number): ReachableStockUnits | null {
  const terrain = ctx.terrain;
  const barracks = seatBarracksOf(world, ctx, player);
  if (terrain === undefined || barracks === null) return null;
  const door = interactionCell(world, ctx, terrain, barracks);
  const reach = networkLimitAt(world, terrain, player, terrain.xOf(door), terrain.yOf(door));
  return reachableStock(world, ctx, terrain, player, reach);
}

/** Armed soldiers the seat sends for armour per decision. Authored: a few at a time keep most of the band
 *  at the door while it dresses, and at one decision every 48 ticks a stocked village still dresses dozens
 *  of men a game minute. */
export const ARMOUR_FETCHES_PER_DECISION = 3;

/**
 * Equip orders dressing the armed soldiers of `men` whose armour slot is empty, the best protection the
 * seat's errands can still fetch first ({@link seatArmsStock}), at most {@link ARMOUR_FETCHES_PER_DECISION}.
 * The assistant's recruit arming dresses a man only when his weapon lands, so this is the player's own equip
 * order for the men armed before the armour was made. A man another drive holds or still under an arming
 * booking is left alone; the stock already promised to errands under way is spoken for.
 */
export function armourFetchOrders(
  world: World,
  ctx: SystemContext,
  player: number,
  men: readonly Entity[],
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  let stock: ReachableStockUnits | undefined;
  let underway: Map<number, number> | undefined;
  for (const e of men) {
    if (commands.length >= ARMOUR_FETCHES_PER_DECISION) break;
    const eq = world.tryGet(e, Equipment);
    if (eq === undefined || eq.weapon === null || eq.armor !== null) continue;
    if (world.has(e, AssistantRecruit) || spokenFor(world, e)) continue;
    if (!mayChangeEquipSlot(world, ctx.content, e, 'armor')) continue;
    stock ??= seatArmsStock(world, ctx, player) ?? lendableStockOf(world, ctx, player);
    underway ??= new Map(equipFetchesHeld(world).get(player));
    const held = underway;
    const ledger = stock;
    const goodType = armorGoodsByProtection(ctx.content).find(
      (good) => ledger.units(good) > (held.get(good) ?? 0),
    );
    if (goodType === undefined) break; // the stock lends no armour
    held.set(goodType, (held.get(goodType) ?? 0) + EQUIP_FETCH_UNITS);
    commands.push({ kind: 'equipGood', entity: e, group: 'armor', slot: 0, goodType });
  }
  return commands;
}

/** `player`'s whole lendable stock ({@link FetchableStock}), for a seat with no barracks door to reach
 *  from. */
function lendableStockOf(world: World, ctx: SystemContext, player: number): ReachableStockUnits {
  const ledger = FetchableStock.of(world, ctx);
  return { units: (good) => ledger.lendableUnits(player, good) };
}

/** The healing potions the barracks marks as priority. */
const BARRACKS_POTION_GOOD_IDS: readonly string[] = ['potion_heal_big', 'potion_heal_small'];
const BARRACKS_MEAD_GOOD_IDS: readonly string[] = ['mead'];
/** The amulets the barracks marks, the ones the seat grants its soldiers. */
const BARRACKS_AMULET_GOOD_IDS: readonly string[] = SOLDIER_OUTFIT_GOOD_IDS.filter((id) =>
  id.startsWith('amulet_'),
);

/** The low-tier gear the barracks leaves off its priority (owner ruling): the wooden spear, the short bow,
 *  the short sword (its content id is spelled `sword_shord`) and leather armour. */
const BARRACKS_UNMARKED_GOOD_IDS: readonly string[] = [
  'spear_wooden',
  'bow_short',
  'sword_shord',
  'armor_leather',
];

/**
 * The goods a barracks of `tribe` marks as priority, in the owner's ranking: weapons arming a trade of
 * that tribe, every armour, the healing potions, mead, the amulets, less {@link BARRACKS_UNMARKED_GOOD_IDS}.
 * Owner ruling; the store marks a set, so the ranking orders only the commands.
 */
function barracksPriorityGoods(ctx: SystemContext, tribe: number): number[] {
  const goods: number[] = [];
  const weapons = contentIndex(ctx.content).weaponByTribeAndGoodType.get(tribe);
  for (const [goodType, weapon] of weapons ?? []) if (weapon.jobType !== undefined) goods.push(goodType);
  goods.push(...armorGoodsByProtection(ctx.content));
  for (const ids of [BARRACKS_POTION_GOOD_IDS, BARRACKS_MEAD_GOOD_IDS, BARRACKS_AMULET_GOOD_IDS]) {
    for (const id of ids) {
      const good = goodTypeByContentId(ctx.content, id);
      if (good !== undefined) goods.push(good.typeId);
    }
  }
  const unmarked = new Set(
    BARRACKS_UNMARKED_GOOD_IDS.map((id) => goodTypeByContentId(ctx.content, id)?.typeId),
  );
  return goods.filter((good) => !unmarked.has(good));
}

/**
 * The store-priority marks each finished barracks among `owned` still lacks: every good of
 * {@link barracksPriorityGoods} it shelves, so its porters fetch the army's gear from the seat's other
 * stores. The same command a player clicks; a mark already set is never sent again, and a barracks
 * rebuilt or newly finished is a fresh entity without marks. Work is bounded by the seat's buildings.
 */
export function barracksPriorityOrders(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  for (const barracks of owned) {
    if (!isBarracks(world, ctx, barracks)) continue;
    const { buildingType, tribe } = world.get(barracks, Building);
    if (!keepsStorePriority(ctx.content, buildingType)) continue;
    const marked = storePriorityGoods(world, barracks);
    for (const goodType of barracksPriorityGoods(ctx, tribe)) {
      if (marked.includes(goodType) || stockCapacity(world, ctx, barracks, goodType) <= 0) continue;
      commands.push({ kind: 'setStorePriority', building: barracks, goodType, priority: true });
    }
  }
  return commands;
}
