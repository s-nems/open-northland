import {
  Chest,
  type ChestKind,
  DeferredOrder,
  MealBreak,
  OpenChestOrder,
  OrderQueue,
  Owner,
  PlayerOrder,
  Position,
  Settler,
} from '../../../components/index.js';
import type { PlayerCommand } from '../../../core/commands/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { type HalfCellNode, hexDistanceBetween } from '../../../nav/halfcell.js';
import { homeSettlers } from '../../ai-shared/home-roster.js';
import { anchorNodeOf } from '../../ai-shared/node-geometry.js';
import type { SystemContext } from '../../context.js';
import { isAdultSettler } from '../../family/eligibility.js';
import { interactionNode, resourceWorkCell } from '../../footprint/index.js';
import { peaceGroundFor } from '../../match/peace.js';
import { isDruidJob } from '../../readviews/index.js';
import { anyNeedPressing } from '../../settlers/drives/needs.js';
import { goodsSearchLimitAt } from '../../signposts/reach.js';
import { playerSawNode } from '../../vision/gates.js';
import { seatBaseOf } from '../base.js';
import { type ScoutDanger, scoutDanger } from './danger.js';
import { scoutLostZones } from './lost-zones.js';

/**
 * Owner ruling: a seat opens the closed chests inside its signpost reach, the wooden ones by its scout and
 * the magical ones by a druid when it has one, never a hero. The reach is the goods search from the base
 * door with the signpost groups it catches, the area the seat's gatherers work in, so a chest across water
 * a long walk round lies outside it. With signpost navigation off there is no reach and no chest is opened.
 */

/** A chest the seat may open; lists of them run in ascending entity id. */
interface ChestCandidate {
  readonly chest: Entity;
  readonly node: HalfCellNode;
}

/**
 * The closed `kind` chests `player` saw inside its signpost reach that no settler of its is already on the
 * way to, skipping those on a peace partner's ground, in a zone the seat lost a scout in, or in an enemy
 * building's reach ({@link scoutDanger}). The cheap tests run first, so a map without such chests pays no
 * reach search.
 */
function reachableChests(
  world: World,
  ctx: SystemContext,
  player: number,
  kind: ChestKind,
  danger: ScoutDanger | undefined,
): ChestCandidate[] {
  const terrain = ctx.terrain;
  if (terrain === undefined) return [];
  const seen: ChestCandidate[] = [];
  for (const chest of world.canonicalQuery(Chest, Position)) {
    if (world.get(chest, Chest).kind !== kind) continue;
    const node = anchorNodeOf(world, chest);
    if (node === null || !terrain.inBounds(node.hx, node.hy)) continue;
    if (playerSawNode(ctx.fog, player, node.hx, node.hy)) seen.push({ chest, node });
  }
  if (seen.length === 0) return [];
  const base = seatBaseOf(world, ctx, player);
  if (base === null) return [];
  const door = interactionNode(world, ctx, base);
  const anchor = door === null ? anchorNodeOf(world, base) : { hx: door.x, hy: door.y };
  if (anchor === null) return [];
  const reach = goodsSearchLimitAt(world, ctx.content, terrain, player, anchor.hx, anchor.hy);
  if (reach === null) return [];
  const from = terrain.nodeAtClamped(anchor.hx, anchor.hy);
  const taken = chestsBeingOpened(world, player);
  const peace = peaceGroundFor(world, player);
  const lost = scoutLostZones(world, player, ctx.tick);
  const threat = danger ?? scoutDanger(world, ctx, player);
  return seen.filter(
    ({ chest, node }) =>
      !taken.has(chest) &&
      peace?.bars(node.hx, node.hy) !== true &&
      !lost.node(node.hx, node.hy) &&
      !threat.covers(node.hx, node.hy) &&
      reach.allowsNode(resourceWorkCell(world, ctx, terrain, chest, from)),
  );
}

/** The chest `e` is on the way to: walking the order out, the order parked behind an action that cannot
 *  be broken off, or the order waiting in his queue, where a meal break puts it. */
function chestErrandOf(world: World, e: Entity): Entity | null {
  const walking = world.tryGet(e, OpenChestOrder);
  if (walking !== undefined) return walking.chest;
  const parked = world.tryGet(e, DeferredOrder)?.command;
  if (parked?.kind === 'openChest') return parked.chest;
  for (const queued of world.tryGet(e, OrderQueue)?.orders ?? []) {
    if (queued.kind === 'openChest') return queued.chest;
  }
  return null;
}

/** The chests some settler of `player`'s is on the way to ({@link chestErrandOf}). Only the settlers that
 *  carry one of the three markers are asked. */
function chestsBeingOpened(world: World, player: number): Set<Entity> {
  const taken = new Set<Entity>();
  for (const marker of [OpenChestOrder, DeferredOrder, OrderQueue]) {
    for (const e of world.query(marker, Owner)) {
      if (world.get(e, Owner).player !== player) continue;
      const chest = chestErrandOf(world, e);
      if (chest !== null) taken.add(chest);
    }
  }
  return taken;
}

/** The candidate nearest `at`, the lowest id on a tie. */
function nearestTo(at: HalfCellNode, candidates: readonly ChestCandidate[]): ChestCandidate | null {
  let best: ChestCandidate | null = null;
  let bestDistance = Infinity;
  for (const c of candidates) {
    const distance = hexDistanceBetween(at.hx, at.hy, c.node.hx, c.node.hy);
    if (distance < bestDistance) {
      best = c;
      bestDistance = distance;
    }
  }
  return best;
}

/** The wooden chest the scout standing at `scoutAt` opens next, the nearest to him, or the lowest id
 *  when he stands nowhere; null with none in reach. */
export function nextScoutChest(
  world: World,
  ctx: SystemContext,
  player: number,
  scoutAt: HalfCellNode | null = null,
  danger?: ScoutDanger,
): Entity | null {
  const candidates = reachableChests(world, ctx, player, 'wooden', danger);
  if (scoutAt === null) return candidates[0]?.chest ?? null;
  return nearestTo(scoutAt, candidates)?.chest ?? null;
}

/**
 * The order sending one of `player`'s druids to a magical chest: the free druid and chest pair nearest
 * each other, ties on the chest and then the druid id. One druid goes at a time, so the huts lose one man
 * for the errand; none while a druid already walks to a chest. A druid at work is free: the order waits out
 * an action that cannot be broken off.
 */
export function druidChestOrder(world: World, ctx: SystemContext, player: number): PlayerCommand | null {
  if (!closedChestStands(world, 'magical')) return null;
  const druids: { entity: Entity; at: HalfCellNode }[] = [];
  // The chests lie in the home base's reach, so a druid of a colony over the water is no candidate.
  for (const e of homeSettlers(world, ctx, player)) {
    if (!isDruidJob(ctx.content, world.get(e, Settler).jobType) || !isAdultSettler(world, e)) continue;
    if (chestErrandOf(world, e) !== null) return null;
    if (druidBusy(world, ctx, e)) continue;
    const at = anchorNodeOf(world, e);
    if (at !== null) druids.push({ entity: e, at });
  }
  if (druids.length === 0) return null;
  const candidates = reachableChests(world, ctx, player, 'magical', undefined);
  let best: { druid: Entity; chest: Entity; distance: number } | null = null;
  for (const druid of druids) {
    const chest = nearestTo(druid.at, candidates);
    if (chest === null) continue;
    const distance = hexDistanceBetween(druid.at.hx, druid.at.hy, chest.node.hx, chest.node.hy);
    if (best === null || distance < best.distance || (distance === best.distance && chest.chest < best.chest))
      best = { druid: druid.entity, chest: chest.chest, distance };
  }
  return best === null ? null : { kind: 'openChest', entity: best.druid, chest: best.chest };
}

/** Whether any closed `kind` chest stands on the map, the guard that spares a map without one the roster
 *  walk. */
function closedChestStands(world: World, kind: ChestKind): boolean {
  for (const chest of world.query(Chest)) if (world.get(chest, Chest).kind === kind) return true;
  return false;
}

/** Whether a druid takes no chest errand now: on another order, parked or queued too, or answering a need,
 *  which a fresh order would cut short. A running work action does not count. */
function druidBusy(world: World, ctx: SystemContext, druid: Entity): boolean {
  return (
    world.has(druid, PlayerOrder) ||
    world.has(druid, DeferredOrder) ||
    world.has(druid, MealBreak) ||
    (world.tryGet(druid, OrderQueue)?.orders.length ?? 0) > 0 ||
    anyNeedPressing(world, ctx, druid)
  );
}
