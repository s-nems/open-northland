import { Equipment, EquipOrder, ownerOf, ownersCompatible, Stockpile } from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { buildingBlockedCells } from '../../footprint/index.js';
import { freeSlotFor, type GrantSpec } from '../../settlers/planner/assistant-grants.js';
import { approachNode } from '../../settlers/planner/recruit-arming.js';
import { interactionCell, storeYieldsGood } from '../../settlers/targets/index.js';
import { networkLimitAt } from '../../signposts/index.js';
import { accessibleStockAmounts } from '../../stores/index.js';
import { seatBarracksOf } from '../base.js';
import { goodTypeByContentId } from '../content-lookup.js';

/** The misc goods every soldier waiting at the barracks is sent to fetch, one slot each, whenever a store
 *  holds a unit (authored). The seat's druids and coiners make exactly these. */
export const SOLDIER_OUTFIT_GOOD_IDS: readonly string[] = [
  'potion_heal_big',
  'amulet_defense',
  'amulet_strength',
];

/**
 * Send each soldier in `waiting` for the first {@link SOLDIER_OUTFIT_GOOD_IDS} good he lacks, one errand
 * per man per decision and never more errands for a good than the stores the barracks door can reach hold.
 * `waiting` must be men the campaign leaves standing at the door this decision, since a walk order strips
 * the errand.
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
  const outfit = outfitSpecs(ctx);
  const commands: PlayerCommand[] = [];
  let spare: Map<number, number> | undefined; // stock minus errands underway, walked on first need
  for (const e of waiting) {
    const eq = world.tryGet(e, Equipment);
    for (const spec of outfit) {
      const slot = freeSlotFor(eq, spec);
      if (slot === null) continue;
      spare ??= spareOutfitStock(
        world,
        ctx,
        terrain,
        player,
        interactionCell(world, ctx, terrain, barracks),
        outfit,
      );
      const units = spare.get(spec.goodType) ?? 0;
      if (units <= 0) continue;
      spare.set(spec.goodType, units - 1);
      commands.push({ kind: 'equipGood', entity: e, group: spec.category, slot, goodType: spec.goodType });
      break;
    }
  }
  return commands;
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

/** Units of each outfit good in the stores the `door`'s signpost network reaches, less the fetch errands
 *  already after one - the same store rule and reach the garrison's arming probe applies. */
function spareOutfitStock(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  door: NodeId,
  outfit: readonly GrantSpec[],
): Map<number, number> {
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
  return spare;
}
