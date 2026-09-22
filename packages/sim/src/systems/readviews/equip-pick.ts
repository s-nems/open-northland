import type { ContentSet, EquipCategory } from '@open-northland/data';
import { Age, Female, ownerOf, Position, Settler, Stockpile, sameSideAs } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext } from '../context.js';
import { equipFetchLimitFor } from '../signposts/index.js';
import { accessibleStockAmounts, mayFetchGoodFrom } from '../stores/index.js';
import { isFighterJob, isHeroJob } from './jobs.js';

/** One equip pick-menu row: an equippable good for the slot and how many units the settler can reach. */
export interface EquipPickEntry {
  readonly goodType: number;
  readonly available: number;
}

/**
 * Whether the settler's equipment may change at all: only a grown man who is no hero. A woman and a
 * child wear nothing, and a hero keeps the fixed arms its job carries. Original behavior, unconfirmed
 * against the running original: only an adult male non-hero can equip anything.
 */
export function mayChangeEquipment(world: World, content: ContentSet, entity: Entity): boolean {
  const settler = world.tryGet(entity, Settler);
  if (settler === undefined || world.has(entity, Age) || world.has(entity, Female)) return false;
  return !isHeroJob(content, settler.jobType);
}

/** Whether the trade may wear this equipment category in the original change-equipment window. */
export function canEquipCategory(content: ContentSet, jobType: number | null, group: EquipCategory): boolean {
  const fighter = isFighterJob(content, jobType);
  return fighter ? group !== 'tool' : group !== 'weapon' && group !== 'armor';
}

/**
 * Every good wearable in a `group` slot that `entity` could fetch right now, in content `goods` order,
 * with the reachable unit count. A good with no reachable unit is omitted. The original's group window
 * intersects `IsAbleToEquipGoodNow` across the selection: fighters lose tools, civilians lose arms, and
 * boots/misc remain common to both.
 *
 * Mirrors the equip errand's source predicate, with two approximations against its exact walk: the
 * fetch gate tests the store's own node rather than its interaction cell, and the
 * buried-under-a-building filter is skipped, so a row may rarely name a unit the fetch cannot reach.
 */
export function equipPickList(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph | undefined,
  entity: Entity,
  group: EquipCategory,
): EquipPickEntry[] {
  if (!mayChangeEquipment(world, content, entity)) return [];
  if (!canEquipCategory(content, world.get(entity, Settler).jobType, group)) return [];
  const available = new Map<number, number>(); // insertion = content order, the menu's row order
  for (const good of content.goods) {
    if (good.equip?.category === group) available.set(good.typeId, 0);
  }
  if (available.size === 0) return [];
  const ctx: ContentContext = { content };
  const limit = terrain === undefined ? null : equipFetchLimitFor(world, content, terrain, entity);
  const onSide = sameSideAs(world, ownerOf(world, entity)); // the errand never fetches a rival's stock
  for (const store of world.query(Stockpile, Position)) {
    const stock = accessibleStockAmounts(world, store);
    if (stock === undefined) continue;
    if (!onSide(store)) continue;
    if (limit !== null && terrain !== undefined) {
      const p = world.get(store, Position);
      const n = nodeOfPosition(p.x, p.y);
      if (!limit.allowsNode(terrain.nodeAtClamped(n.hx, n.hy))) continue;
    }
    for (const [goodType, amount] of stock) {
      const held = available.get(goodType);
      if (held === undefined || amount <= 0) continue;
      if (!mayFetchGoodFrom(world, ctx, store, goodType)) continue;
      available.set(goodType, held + amount);
    }
  }
  const rows: EquipPickEntry[] = [];
  for (const [goodType, count] of available) {
    if (count > 0) rows.push({ goodType, available: count });
  }
  return rows;
}
