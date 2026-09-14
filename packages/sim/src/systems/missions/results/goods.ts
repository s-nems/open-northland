import { BUILDING_KIND } from '@open-northland/data';
import { Building, ownerOf, Position, Stockpile } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import { ONE } from '../../../core/fixed.js';
import type { Entity } from '../../../ecs/world.js';
import {
  type HalfCellNode,
  hexDistance,
  hexDistanceBetween,
  nodeOfPosition,
  positionOfNode,
} from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { dynamicBlockOverlay } from '../../footprint/index.js';
import { reapEmptyLoosePile, stackOntoTile } from '../../settlers/atomics/effects/goods/index.js';
import { canonicalById } from '../../spatial/nodes.js';
import { stockpilesAtNode } from '../../spatial/stockpiles.js';
import { isLoosePile } from '../../stores/index.js';
import type { MissionPass } from '../pass.js';
import type { MissionResultOp } from '../script.js';
import { addStock, countsAsOwnStock, roomFor, takeStock, typeStoresGood } from '../stock.js';
import { missionHouses } from '../targets.js';

/** Put the amount into every house carrying the id that has a slot for the good, full or not. */
export function addGoodsToHouses(pass: MissionPass, id: number, good: number, amount: number): void {
  const { world, ctx } = pass;
  for (const e of missionHouses(world, id)) {
    if (typeStoresGood(ctx, world.get(e, Building).buildingType, good)) addStock(world, e, good, amount);
  }
}

/** Fill the player's finished storages in ascending id order, each up to its slot's capacity, until
 *  the amount is placed. What no storage has room for is lost. */
export function addGoodsToAnyStock(pass: MissionPass, player: number, good: number, amount: number): void {
  const { world, ctx } = pass;
  let left = amount;
  for (const e of canonicalById(world.query(Building, Stockpile))) {
    if (left <= 0) return;
    const building = world.get(e, Building);
    if (building.built !== ONE || ownerOf(world, e) !== player) continue;
    if (contentIndex(ctx.content).buildings.get(building.buildingType)?.kind !== BUILDING_KIND.storage)
      continue;
    const placed = Math.min(left, roomFor(world, ctx, e, good));
    addStock(world, e, good, placed);
    left -= placed;
  }
}

type AreaGoodsOp = Extract<MissionResultOp, { opcode: 'AddGoodsToMapArea' | 'RemoveGoodsFromMapArea' }>;

/**
 * Drop the good around the point, nearest ring first: into the player's finished houses standing at
 * that distance when the line's flag says so, then in stacks on the ground, until the amount is
 * placed or the range runs out. Approximation: within one ring the original walks the six hexagon
 * legs in turn, this walks the nodes in ascending id order.
 */
export function addGoodsToArea(pass: MissionPass, mission: number, op: AreaGoodsOp): void {
  const { world, ctx } = pass;
  const terrain = ctx.terrain;
  if (terrain === undefined) {
    pass.reportFailed(mission, op.opcode); // a mapless world has no ground to lay anything on
    return;
  }
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  walkArea(pass, terrain, op, typeStoresGood, {
    atHouse: (e, left) => {
      const placed = Math.min(left, roomFor(world, ctx, e, op.good));
      addStock(world, e, op.good, placed);
      return placed;
    },
    atGround: (node, left) => {
      if (!terrain.isWalkable(node) || blocked.has(node)) return 0;
      const at = positionOfNode(terrain.xOf(node), terrain.yOf(node));
      return stackOntoTile(world, at.x, at.y, op.good, left);
    },
  });
}

/** Pick the good up the same way: out of the player's finished houses that hold it as their own stock
 *  when the flag says so, then off the ground, reaping each heap the pick empties. */
export function removeGoodsFromArea(pass: MissionPass, mission: number, op: AreaGoodsOp): void {
  const { world, ctx } = pass;
  const terrain = ctx.terrain;
  if (terrain === undefined) {
    pass.reportFailed(mission, op.opcode);
    return;
  }
  walkArea(pass, terrain, op, countsAsOwnStock, {
    atHouse: (e, left) => takeStock(world, e, op.good, left),
    atGround: (node, left) => {
      let taken = 0;
      // Copied, because a reap destroys under the live index bucket the lookup hands out.
      for (const e of [...stockpilesAtNode(world, terrain.xOf(node), terrain.yOf(node))]) {
        if (taken >= left) break;
        if (!isLoosePile(world, e)) continue;
        const took = takeStock(world, e, op.good, left - taken);
        if (took === 0) continue; // another good's heap, or one a porter already drained: not this line's
        taken += took;
        reapEmptyLoosePile(world, e);
      }
      return taken;
    },
  });
}

interface AreaVisitor {
  /** Returns how many units the house took or gave. */
  readonly atHouse: (house: Entity, left: number) => number;
  readonly atGround: (node: NodeId, left: number) => number;
}

function walkArea(
  pass: MissionPass,
  terrain: TerrainGraph,
  op: AreaGoodsOp,
  houseHolds: (ctx: SystemContext, buildingType: number, good: number) => boolean,
  visit: AreaVisitor,
): void {
  if (op.amount <= 0) return;
  const houses = op.flag ? housesByDistance(pass, op, houseHolds) : new Map<number, Entity[]>();
  const rings = ringsAround(terrain, op.point, op.range);
  let left = op.amount;
  const distances = [...new Set([...houses.keys(), ...rings.keys()])].sort((a, b) => a - b);
  for (const r of distances) {
    for (const e of houses.get(r) ?? []) {
      if (left <= 0) return;
      left -= visit.atHouse(e, left);
    }
    for (const node of rings.get(r) ?? []) {
      if (left <= 0) return;
      left -= visit.atGround(node, left);
    }
  }
}

/** The player's finished houses with a place for the good, bucketed by their anchor's distance from
 *  the point and ascending by id within a bucket. */
function housesByDistance(
  pass: MissionPass,
  op: AreaGoodsOp,
  houseHolds: (ctx: SystemContext, buildingType: number, good: number) => boolean,
): Map<number, Entity[]> {
  const { world, ctx } = pass;
  const buckets = new Map<number, Entity[]>();
  for (const e of canonicalById(world.query(Building, Stockpile, Position))) {
    const building = world.get(e, Building);
    if (building.built !== ONE || ownerOf(world, e) !== op.player) continue;
    if (!houseHolds(ctx, building.buildingType, op.good)) continue;
    const at = world.get(e, Position);
    const distance = hexDistance(nodeOfPosition(at.x, at.y), op.point);
    if (distance > op.range) continue;
    bucketAt(buckets, distance).push(e);
  }
  return buckets;
}

/** Every in-bounds node within `range` of the point, bucketed by distance; the row-major scan leaves
 *  each ring ascending by id. Clipped to the map, so a map-wide or far-off point costs the map, not
 *  the range. */
function ringsAround(terrain: TerrainGraph, point: HalfCellNode, range: number): Map<number, NodeId[]> {
  const rings = new Map<number, NodeId[]>();
  for (let hy = Math.max(0, point.hy - range); hy <= Math.min(terrain.height - 1, point.hy + range); hy++) {
    for (let hx = Math.max(0, point.hx - range); hx <= Math.min(terrain.width - 1, point.hx + range); hx++) {
      const distance = hexDistanceBetween(hx, hy, point.hx, point.hy);
      if (distance <= range) bucketAt(rings, distance).push(terrain.nodeAt(hx, hy));
    }
  }
  return rings;
}

function bucketAt<T>(buckets: Map<number, T[]>, index: number): T[] {
  let bucket = buckets.get(index);
  if (bucket === undefined) {
    bucket = [];
    buckets.set(index, bucket);
  }
  return bucket;
}
