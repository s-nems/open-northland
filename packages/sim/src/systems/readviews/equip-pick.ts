import type { ContentSet, EquipCategory } from '@open-northland/data';
import { Position, Stockpile, UnderConstruction } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { navigationLimitFor } from '../signposts/index.js';

/** One equip pick-menu row: an equippable good for the slot and how many units the settler can reach. */
export interface EquipPickEntry {
  readonly goodType: number;
  readonly available: number;
}

/**
 * The equip pick-menu's read view: every good wearable in a `group` slot that `entity` could actually
 * go and fetch right now - held by a store or ground pile the settler's signpost confinement allows
 * (or anywhere, when confinement is off / the settler is exempt) - with the reachable unit count.
 * Rows keep the content `goods` order; a good with no reachable unit is omitted (the menu shows what
 * IS available, per the feature spec).
 *
 * Mirrors the equip errand's source predicate (`nearestStoreHolding`): a positioned stockpile that is
 * not a construction site. Two named approximations against the errand's exact walk: the confinement
 * gate tests the store's own node (not its interaction cell), and the buried-under-a-building filter
 * is skipped - a menu row may thus rarely name a unit the fetch then fails to reach, which the errand
 * already survives (it returns empty-handed).
 */
export function equipPickList(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph | undefined,
  entity: Entity,
  group: EquipCategory,
): EquipPickEntry[] {
  const available = new Map<number, number>(); // insertion = content order, the menu's row order
  for (const good of content.goods) {
    if (good.equip?.category === group) available.set(good.typeId, 0);
  }
  if (available.size === 0) return [];
  const limit = terrain === undefined ? null : navigationLimitFor(world, terrain, entity);
  for (const store of world.query(Stockpile, Position)) {
    if (world.has(store, UnderConstruction)) continue; // a site is a sink, never a source
    if (limit !== null && terrain !== undefined) {
      const p = world.get(store, Position);
      const n = nodeOfPosition(p.x, p.y);
      if (!limit.allowsNode(terrain.nodeAtClamped(n.hx, n.hy))) continue;
    }
    for (const [goodType, amount] of world.get(store, Stockpile).amounts) {
      const held = available.get(goodType);
      if (held !== undefined && amount > 0) available.set(goodType, held + amount);
    }
  }
  const rows: EquipPickEntry[] = [];
  for (const [goodType, count] of available) {
    if (count > 0) rows.push({ goodType, available: count });
  }
  return rows;
}
