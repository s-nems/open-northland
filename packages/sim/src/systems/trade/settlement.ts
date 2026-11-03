import { BUILDING_KIND } from '@open-northland/data';
import { Building, ownerOf, type TradeStop } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { DeepReadonly, Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext, MapContext, SystemContext } from '../context.js';
import { interactionNodeId } from '../footprint/interaction.js';
import { FetchableStock } from '../settlers/targets/index.js';
import { goodsSearchesShareDoor, goodsSearchLimitAt, signpostReachKey } from '../signposts/reach.js';
import { isWorkplaceOutput } from '../stores/index.js';
import { sameFoodClass } from './goods.js';

/** Whether a stop at `house` may stand for its settlement: the house is a storehouse. */
export function isSettlementAnchor(world: World, ctx: ContentContext, house: Entity): boolean {
  const type = world.tryGet(house, Building)?.buildingType;
  return type !== undefined && contentIndex(ctx.content).buildings.get(type)?.kind === BUILDING_KIND.storage;
}

/**
 * The houses of `anchor`'s settlement besides it and `exclude` that hold `good` or a dish of its edible
 * class, ascending by id: the trader's own finished storehouses, and workshops whose output the good is,
 * whose door the goods search from the anchor's door reaches, the reach a porter there fetches through.
 * With signpost navigation off that search sets no bound, so the anchor's continent bounds it instead.
 */
export function settlementHouses(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  trader: Entity,
  anchor: Entity,
  exclude: Entity,
  good: number,
): Entity[] {
  const player = ownerOf(world, trader);
  const anchorDoor = interactionNodeId(world, ctx, terrain, anchor);
  if (player === undefined || anchorDoor === null) return [];
  const reach = limitAtDoor(world, ctx, terrain, player, anchorDoor);
  const continent = terrain.componentOf(anchorDoor);
  const ledger = FetchableStock.of(world, ctx);
  const found = new Set<Entity>();
  for (const { typeId: form } of ctx.content.goods) {
    if (!sameFoodClass(ctx, form, good)) continue;
    for (const house of ledger.holders(form)) {
      if (house === anchor || house === exclude || found.has(house)) continue;
      if (ownerOf(world, house) !== player || !lendsToSettlement(world, ctx, house, form)) continue;
      const door = interactionNodeId(world, ctx, terrain, house);
      if (door === null) continue;
      if (reach === null ? terrain.componentOf(door) === continent : reach.allowsNode(door)) found.add(house);
    }
  }
  return [...found].sort((a, b) => a - b);
}

function lendsToSettlement(world: World, ctx: SystemContext, house: Entity, good: number): boolean {
  const building = world.tryGet(house, Building);
  if (building === undefined || building.built !== ONE) return false;
  const kind = contentIndex(ctx.content).buildings.get(building.buildingType)?.kind;
  if (kind === BUILDING_KIND.storage) return true;
  return kind === BUILDING_KIND.workplace && isWorkplaceOutput(world, ctx, house, good);
}

/** A held overlap verdict per pair of anchors, with the reach state it was read under. */
interface OverlapVerdict {
  readonly terrain: TerrainGraph;
  readonly key: string;
  readonly overlap: boolean;
}
const overlapVerdicts = new WeakMap<World, Map<string, OverlapVerdict>>();

/**
 * Whether the settlements of `trader`'s storehouses `a` and `b` share a house: one of the player's
 * buildings lies in both goods searches. Different continents never share one; with signpost navigation
 * off one continent always does, as a settlement then spans its continent. Our own extension: a route
 * may stand for two settlements only while they stay apart.
 */
export function settlementsOverlap(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  trader: Entity,
  a: Entity,
  b: Entity,
): boolean {
  const player = ownerOf(world, trader);
  const doorA = interactionNodeId(world, ctx, terrain, a);
  const doorB = interactionNodeId(world, ctx, terrain, b);
  if (player === undefined || doorA === null || doorB === null) return false;
  if (terrain.componentOf(doorA) !== terrain.componentOf(doorB)) return false;
  const limitA = limitAtDoor(world, ctx, terrain, player, doorA);
  if (limitA === null) return true;
  // The walk reads the player's doors and the two searches, all versioned by the reach key and the
  // terrain's resistance clock, so a held verdict answers as a fresh walk would.
  const key = `${signpostReachKey(world, ctx.content, terrain)}:${terrain.resistanceClock}`;
  const pair = `${player}:${Math.min(a, b)}:${Math.max(a, b)}`;
  let verdicts = overlapVerdicts.get(world);
  if (verdicts === undefined) {
    verdicts = new Map();
    overlapVerdicts.set(world, verdicts);
  }
  const held = verdicts.get(pair);
  if (held !== undefined && held.terrain === terrain && held.key === key) return held.overlap;
  const limitB = limitAtDoor(world, ctx, terrain, player, doorB);
  const overlap =
    limitB !== null && goodsSearchesShareDoor(world, ctx.content, terrain, player, limitA, limitB);
  verdicts.set(pair, { terrain, key, overlap });
  return overlap;
}

function limitAtDoor(
  world: World,
  ctx: MapContext,
  terrain: TerrainGraph,
  player: number,
  door: NodeId,
): ReturnType<typeof goodsSearchLimitAt> {
  return goodsSearchLimitAt(world, ctx.content, terrain, player, terrain.xOf(door), terrain.yOf(door));
}

/**
 * Whether the stop at `index` of a two-stop own route stands for its settlement now: its flag is set,
 * and when both stops carry it, their settlements stay apart, else the second stop counts its
 * storehouse alone. Our own extension, for networks joined after both flags were set.
 */
export function standsForSettlement(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  trader: Entity,
  stops: DeepReadonly<TradeStop[]>,
  index: number,
): boolean {
  const stop = stops[index];
  if (stop?.settlement !== true) return false;
  const first = stops[0];
  if (index === 0 || first === undefined || !first.settlement) return true;
  return !settlementsOverlap(world, ctx, terrain, trader, first.house, stop.house);
}
