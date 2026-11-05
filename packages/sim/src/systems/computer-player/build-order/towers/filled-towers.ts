import { Building, Stockpile } from '../../../../components/index.js';
import { contentIndex } from '../../../../core/content-index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { buildingTypeByContentId, goodTypeByContentId } from '../../../ai-shared/content-lookup.js';
import { isBuilt } from '../../../ai-shared/seat-roster.js';
import type { SystemContext } from '../../../context.js';
import { homeStockOf } from '../../colony/stock.js';
import { TOWER_CONTENT_IDS } from '../ground/front.js';
import { roomFilled } from '../ground/room.js';
import { FILLED_TOWER_BUILDING } from '../order/military-line.js';
import { sitesClaims } from '../supply/upgrade-supply.js';

/** The goods a filled-ring tower may only take from the home's spare (owner ruling: the stone and wood the
 *  ship yard and the sites wait on go to them first). */
const SPARE_ONLY_GOOD_IDS: readonly string[] = ['stone', 'wood'];

/** The most towers a seat's settlement holds before the filled ring stops (authored): about two over the
 *  four to eight its rings raised on arabskie_wyspy_wolna_gra_mieszana by game minute 150. */
export const FILLED_TOWERS_CAP = 8;

/**
 * Whether the filled ring still waits: the seat's land fits another home ({@link roomFilled}), so the homes
 * lift comes first; it owns {@link FILLED_TOWERS_CAP} towers; or its home store cannot pay a lower tower's
 * bill, the stone and wood out of what is left over the workshops' unfilled input shelves (the ship yard
 * among them) and the sites' claims. Our own approximation of a cheap tower in the settlement's gaps.
 */
export function filledTowersWait(
  world: World,
  ctx: SystemContext,
  player: number,
  owned: readonly Entity[],
): boolean {
  if (!roomFilled(world, player)) return true;
  const index = contentIndex(ctx.content);
  let towers = 0;
  for (const e of owned) {
    const id = index.buildings.get(world.get(e, Building).buildingType)?.id;
    if (id !== undefined && TOWER_CONTENT_IDS.includes(id)) towers++;
  }
  if (towers >= FILLED_TOWERS_CAP) return true;
  const tower = buildingTypeByContentId(ctx.content, FILLED_TOWER_BUILDING);
  if (tower === undefined) return true;
  const spareOnly = new Set<number>();
  for (const id of SPARE_ONLY_GOOD_IDS) {
    const good = goodTypeByContentId(ctx.content, id);
    if (good !== undefined) spareOnly.add(good.typeId);
  }
  const stock = homeStockOf(world, ctx, player);
  const waited = spareOnly.size === 0 ? new Map<number, number>() : waitedOn(world, ctx, owned, spareOnly);
  for (const line of index.constructionBillByBuilding.get(tower.typeId) ?? []) {
    const reserved = waited.get(line.goodType) ?? 0;
    if (stock.units(line.goodType) - reserved < line.amount) return true;
  }
  return false;
}

/** What the home's sites hold, still lack or keep aside, and its built workshops' input shelves still want,
 *  of `goods`. */
function waitedOn(
  world: World,
  ctx: SystemContext,
  owned: readonly Entity[],
  goods: ReadonlySet<number>,
): Map<number, number> {
  const index = contentIndex(ctx.content);
  const waited = new Map<number, number>();
  const add = (good: number, units: number) => {
    if (goods.has(good) && units > 0) waited.set(good, (waited.get(good) ?? 0) + units);
  };
  for (const [good, claimed] of sitesClaims(world, ctx, owned)) add(good, claimed);
  for (const e of owned) {
    if (!isBuilt(world, e)) continue;
    const typeId = world.get(e, Building).buildingType;
    const capacity = index.stockSlotCapacityByBuilding.get(typeId);
    const held = world.tryGet(e, Stockpile)?.amounts;
    for (const input of index.mergedRecipeByBuilding.get(typeId)?.inputs ?? [])
      add(input.goodType, (capacity?.get(input.goodType) ?? 0) - (held?.get(input.goodType) ?? 0));
  }
  return waited;
}
