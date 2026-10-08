import type { ContentSet, EquipCategory } from '@open-northland/data';
import { Age, Female, ownerOf, Position, Settler, Stockpile, sameSideAs } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import type { SpatialGate } from '../../nav/node-circle.js';
import { intersectReach } from '../../nav/range-search.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext, MapContext } from '../context.js';
import { interactionCellOf } from '../footprint/interaction.js';
import { equipErrandConfinement, navigationLimitFor } from '../signposts/index.js';
import { goodsSearchLimitAt } from '../signposts/reach.js';
import { accessibleStockAmounts, mayFetchGoodFrom } from '../stores/index.js';
import { isFighterJob, isHeroJob } from './jobs.js';

/** One equip pick-menu row: an equippable good for the slot and how many units the settler can reach. */
export interface EquipPickEntry {
  readonly goodType: number;
  readonly available: number;
}

/** One row of the selection's equip menu: a good some selected settler can wear and reach. */
export interface EquipSelectionPick extends EquipPickEntry {
  readonly group: EquipCategory;
  /** The selected settlers that can wear the good and reach a unit of it, in selection order. */
  readonly takers: readonly Entity[];
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
 * with the reachable unit count. A good with no reachable unit is omitted. Original behavior: fighters
 * may wear no tool, civilians no arms, and boots and misc are common to both.
 */
export function equipPickList(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph | undefined,
  entity: Entity,
  group: EquipCategory,
): EquipPickEntry[] {
  const rows: EquipPickEntry[] = [];
  for (const row of equipPicksForSelection(world, content, terrain, [entity])) {
    if (row.group === group) rows.push({ goodType: row.goodType, available: row.available });
  }
  return rows;
}

/** A store holding equippable goods a fetch may lift, at the node a fetch reaches it. */
interface EquipSource {
  readonly store: Entity;
  /** The building's door, or a pile's own node; null in a mapless sim, where no gate applies. */
  readonly node: NodeId | null;
  readonly goods: readonly { readonly goodType: number; readonly amount: number }[];
}

interface SelectionRow {
  readonly group: EquipCategory;
  /** Each store counts once however many settlers reach it. */
  readonly reached: Set<Entity>;
  available: number;
  readonly takers: Entity[];
}

/**
 * The selection's equip menu: every good some selected settler can wear and reach, in content `goods`
 * order, with the units the selection as a whole reaches and the settlers a click would send. A settler
 * whose equipment cannot change, or who cannot wear the category, takes nothing. Authored: the original's
 * group window intersects the selection's wearable sets; this unions them so one far or ineligible
 * settler hides no row from the rest.
 *
 * Mirrors the equip errand's source predicate (same side, fetchable stock, the errand's gate tested at
 * the store's door) with two approximations: units other errands already claim still count, and the
 * buried-under-a-building filter is skipped, so a row may rarely name a unit the fetch cannot reach.
 * A click-time read: one pass over every store, then the members times the stores holding equippables.
 */
export function equipPicksForSelection(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph | undefined,
  entities: readonly Entity[],
): EquipSelectionPick[] {
  const groupOf = new Map<number, EquipCategory>(); // insertion = content order, the menu's row order
  for (const good of content.goods) {
    if (good.equip !== undefined) groupOf.set(good.typeId, good.equip.category);
  }
  if (groupOf.size === 0 || entities.length === 0) return [];
  const sources = equipSources(world, terrain === undefined ? { content } : { content, terrain }, groupOf);
  if (sources.length === 0) return [];
  const rows = new Map<number, SelectionRow>();
  const onSideOf = new Map<number | undefined, (e: Entity) => boolean>();
  const seen = new Set<Entity>();
  for (const entity of entities) {
    if (seen.has(entity)) continue;
    seen.add(entity);
    if (!mayChangeEquipment(world, content, entity) || !world.has(entity, Position)) continue;
    const jobType = world.get(entity, Settler).jobType;
    const owner = ownerOf(world, entity); // the errand never fetches a rival's stock
    let onSide = onSideOf.get(owner);
    if (onSide === undefined) {
      onSide = sameSideAs(world, owner);
      onSideOf.set(owner, onSide);
    }
    const gate = terrain === undefined ? null : fetchGateFor(world, content, terrain, entity, owner);
    for (const source of sources) {
      if (!onSide(source.store)) continue;
      if (gate !== null && source.node !== null && !gate.allowsNode(source.node)) continue;
      for (const { goodType, amount } of source.goods) {
        const group = groupOf.get(goodType);
        if (group === undefined || !canEquipCategory(content, jobType, group)) continue;
        let row = rows.get(goodType);
        if (row === undefined) {
          row = { group, reached: new Set(), available: 0, takers: [] };
          rows.set(goodType, row);
        }
        if (!row.reached.has(source.store)) {
          row.reached.add(source.store);
          row.available += amount;
        }
        if (row.takers[row.takers.length - 1] !== entity) row.takers.push(entity);
      }
    }
  }
  const picks: EquipSelectionPick[] = [];
  for (const goodType of groupOf.keys()) {
    const row = rows.get(goodType);
    if (row !== undefined) {
      picks.push({ goodType, group: row.group, available: row.available, takers: row.takers });
    }
  }
  return picks;
}

/** The stores holding a fetchable unit of some equippable good, in world query order. */
function equipSources(
  world: World,
  ctx: MapContext,
  groupOf: ReadonlyMap<number, EquipCategory>,
): EquipSource[] {
  const fetchCtx: ContentContext = { content: ctx.content };
  const sources: EquipSource[] = [];
  for (const store of world.query(Stockpile, Position)) {
    const stock = accessibleStockAmounts(world, store);
    if (stock === undefined) continue;
    const goods: { goodType: number; amount: number }[] = [];
    for (const [goodType, amount] of stock) {
      if (amount <= 0 || !groupOf.has(goodType)) continue;
      if (!mayFetchGoodFrom(world, fetchCtx, store, goodType)) continue;
      goods.push({ goodType, amount });
    }
    if (goods.length === 0) continue;
    sources.push({ store, node: fetchNodeOf(world, ctx, store), goods });
  }
  return sources;
}

/** Where a fetch reaches `store`: a building's door, a pile's own node. */
function fetchNodeOf(world: World, ctx: MapContext, store: Entity): NodeId | null {
  const terrain = ctx.terrain;
  if (terrain === undefined) return null;
  const door = interactionCellOf(world, ctx, terrain, store);
  if (door !== null) return door;
  const p = world.get(store, Position);
  return terrain.nodeAtClamped(nodeHxOfPosition(p.x, p.y), nodeHyOfPosition(p.y));
}

/** The gate the errand's store search applies for `entity`: its confinement cut to the goods search
 *  from where it stands. Null when nothing confines it. */
function fetchGateFor(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  entity: Entity,
  owner: number | undefined,
): SpatialGate | null {
  const p = world.get(entity, Position);
  const hx = nodeHxOfPosition(p.x, p.y);
  const hy = nodeHyOfPosition(p.y);
  const here = terrain.nodeAtClamped(hx, hy);
  const confinement = equipErrandConfinement(
    world,
    terrain,
    entity,
    here,
    navigationLimitFor(world, content, terrain, entity),
  );
  return intersectReach(confinement, goodsSearchLimitAt(world, content, terrain, owner, hx, hy)) ?? null;
}
