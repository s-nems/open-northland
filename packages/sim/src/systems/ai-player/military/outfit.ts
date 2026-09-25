import {
  AssistantWeaponVetoes,
  Equipment,
  EquipOrder,
  ownerOf,
  ownersCompatible,
  playerGoodList,
  Settler,
  Stockpile,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { buildingBlockedCells } from '../../footprint/index.js';
import { ARMOR_MAIN_TYPE, armorByClass, isFighterJob } from '../../readviews/index.js';
import { INTENT_WEAPON_CLASS } from '../../settlers/atomics/effects/goods/weapon-class.js';
import { freeSlotFor, type GrantSpec } from '../../settlers/planner/assistant-grants.js';
import { approachNode, armingGoodPreference } from '../../settlers/planner/recruit-arming.js';
import { interactionCell, storeYieldsGood } from '../../settlers/targets/index.js';
import { networkLimitAt } from '../../signposts/index.js';
import { accessibleStockAmounts } from '../../stores/index.js';
import { seatBarracksOf } from '../base.js';
import { goodTypeByContentId } from '../content-lookup.js';
import { ownedSettlers } from '../seat-roster.js';
import { FULL_FIELD_SHARES, GARRISON_WEAPON_INTENTS } from '../workforce/garrison.js';
import { fighterWeaponClass } from './census.js';

/** The misc goods every soldier waiting at the barracks is sent to fetch, one slot each, whenever a store
 *  holds a unit (authored). The seat's druids and coiners make exactly these. */
export const SOLDIER_OUTFIT_GOOD_IDS: readonly string[] = [
  'potion_heal_big',
  'amulet_defense',
  'amulet_strength',
];

/**
 * Send each soldier in `waiting` for the first thing he lacks: a weapon when he stands bare-handed, then
 * armour, then the {@link SOLDIER_OUTFIT_GOOD_IDS} he has no slot of (owner's rule: a man drilled while
 * the shops were empty is dressed as their goods come in). One errand per man per decision, none for a
 * man whose errand is underway, and never more errands for a good than the stores the barracks door can
 * reach hold. `waiting` must be men the campaign leaves standing at the door this decision, since a walk
 * order strips the errand.
 */
export function outfitOrders(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  waiting: readonly Entity[],
): PlayerCommand[] {
  if (waiting.length === 0) return [];
  const barracks = seatBarracksOf(world, ctx, player);
  if (barracks === null) return [];
  const commands: PlayerCommand[] = [];
  const misc = outfitSpecs(ctx);
  const armour = armourSpecs(ctx);
  const armsFor = new Map<number, ArmsByClass>(); // per tribe of the waiting men
  for (const e of waiting) {
    const { tribe } = world.get(e, Settler);
    if (!armsFor.has(tribe)) armsFor.set(tribe, armsByClass(world, ctx, player, tribe));
  }
  const counted: GrantSpec[] = [
    ...misc,
    ...armour,
    ...[...armsFor.values()].flat(2).map((goodType): GrantSpec => ({ goodType, category: 'weapon' })),
  ];
  let stock: SpareStock | undefined; // stock minus errands underway, walked on first need
  const spare = (): SpareStock => (stock ??= spareStock(world, ctx, terrain, player, barracks, counted));
  let fielded: number[] | undefined; // the army's men per weapon class, this decision's picks included
  for (const e of waiting) {
    if (world.has(e, EquipOrder)) continue;
    const eq = world.tryGet(e, Equipment);
    const arms = armsFor.get(world.get(e, Settler).tribe) ?? [];
    let errand: PlayerCommand | null = null;
    if (freeSlotFor(eq, WEAPON_SLOT) !== null) {
      fielded ??= fieldedByClass(world, ctx, player);
      for (const rank of classesBehindShare(fielded)) {
        const good = (arms[rank] ?? []).find((g) => spare().take(g));
        if (good === undefined) continue;
        errand = { kind: 'equipGood', entity: e, group: 'weapon', slot: 0, goodType: good };
        fielded[rank] = (fielded[rank] ?? 0) + 1;
        break;
      }
    }
    for (const spec of [...armour, ...misc]) {
      if (errand !== null) break;
      const slot = freeSlotFor(eq, spec);
      if (slot === null || !spare().take(spec.goodType)) continue;
      errand = { kind: 'equipGood', entity: e, group: spec.category, slot, goodType: spec.goodType };
    }
    if (errand !== null) commands.push(errand);
  }
  return commands;
}

/** The weapon slot, asked about before any good is chosen for it: a fighter has one. */
const WEAPON_SLOT: GrantSpec = { goodType: -1, category: 'weapon' };

/** The weapon goods a tribe's recruit of each garrison class may be armed with, strongest first, in
 *  {@link GARRISON_WEAPON_INTENTS} order; the seat's vetoed goods left out, as in the draft. */
type ArmsByClass = readonly (readonly number[])[];

function armsByClass(world: World, ctx: SystemContext, player: number, tribe: number): ArmsByClass {
  const vetoed = playerGoodList(world, AssistantWeaponVetoes, player);
  return GARRISON_WEAPON_INTENTS.map((intent) => armingGoodPreference(ctx.content, tribe, intent, vetoed));
}

/** The armour goods worth fetching, the heavy tier before the light one (authored), in content order. */
function armourSpecs(ctx: SystemContext): GrantSpec[] {
  const byClass = armorByClass(ctx.content);
  const specs: GrantSpec[] = [];
  for (const tier of [ARMOR_MAIN_TYPE.HEAVY, ARMOR_MAIN_TYPE.LIGHT]) {
    for (const armor of byClass.get(tier) ?? []) {
      if (armor.goodType !== undefined) specs.push({ goodType: armor.goodType, category: 'armor' });
    }
  }
  return specs;
}

function outfitSpecs(ctx: SystemContext): GrantSpec[] {
  const specs: GrantSpec[] = [];
  for (const id of SOLDIER_OUTFIT_GOOD_IDS) {
    const good = goodTypeByContentId(ctx.content, id);
    if (good?.equip === undefined) continue; // not a wearable in this content set
    specs.push({ goodType: good.typeId, category: good.equip.category });
  }
  return specs;
}

/** The seat's fighters per garrison class, by the weapon each fights with, in
 *  {@link GARRISON_WEAPON_INTENTS} order; a bare-handed man counts for none. */
function fieldedByClass(world: World, ctx: SystemContext, player: number): number[] {
  const fielded = GARRISON_WEAPON_INTENTS.map(() => 0);
  for (const e of ownedSettlers(world, player)) {
    if (!isFighterJob(ctx.content, world.get(e, Settler).jobType)) continue;
    const weaponClass = fighterWeaponClass(world, ctx, e);
    const rank = GARRISON_WEAPON_INTENTS.findIndex((i) => INTENT_WEAPON_CLASS[i] === weaponClass);
    if (rank >= 0) fielded[rank] = (fielded[rank] ?? 0) + 1;
  }
  return fielded;
}

/** The class ranks furthest below their {@link FULL_FIELD_SHARES} first, the earlier class on a tie -
 *  the draft's own order, so a bare man's weapon lands where the next recruit's would. Compared by
 *  cross-multiplication, so the sort stays in integers. */
function classesBehindShare(fielded: readonly number[]): number[] {
  const shares = GARRISON_WEAPON_INTENTS.map((intent) => FULL_FIELD_SHARES[intent]);
  return GARRISON_WEAPON_INTENTS.map((_, rank) => rank).sort(
    (a, b) => (fielded[a] ?? 0) * (shares[b] ?? 1) - (fielded[b] ?? 0) * (shares[a] ?? 1) || a - b,
  );
}

/** Units of each outfit good the stores the barracks door's signpost network reaches hold, less the
 *  fetch errands already after one; each `take` books one more. The same store rule and reach the
 *  garrison's arming probe applies. */
interface SpareStock {
  take(goodType: number): boolean;
}

function spareStock(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  barracks: Entity,
  outfit: readonly GrantSpec[],
): SpareStock {
  const door: NodeId = interactionCell(world, ctx, terrain, barracks);
  const spare = new Map<number, number>();
  const walls = buildingBlockedCells(world, ctx, terrain);
  const reach = networkLimitAt(world, terrain, player, terrain.xOf(door), terrain.yOf(door));
  for (const store of world.query(Stockpile)) {
    if (!ownersCompatible(player, ownerOf(world, store))) continue;
    const amounts = accessibleStockAmounts(world, store);
    if (amounts === undefined) continue;
    let reached: boolean | undefined;
    for (const { goodType } of outfit) {
      if (!storeYieldsGood(world, ctx, terrain, walls, store, goodType)) continue;
      reached ??= reach === null || reach.allowsNode(approachNode(world, ctx, terrain, store));
      if (!reached) break;
      spare.set(goodType, (spare.get(goodType) ?? 0) + (amounts.get(goodType) ?? 0));
    }
  }
  for (const e of world.query(EquipOrder)) {
    const order = world.get(e, EquipOrder);
    if (order.stage !== 'acquire' || order.goodType === null || ownerOf(world, e) !== player) continue;
    const units = spare.get(order.goodType);
    if (units !== undefined) spare.set(order.goodType, units - 1);
  }
  return {
    take: (goodType) => {
      const units = spare.get(goodType) ?? 0;
      if (units <= 0) return false;
      spare.set(goodType, units - 1);
      return true;
    },
  };
}
