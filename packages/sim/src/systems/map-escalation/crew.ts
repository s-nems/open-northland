import { BUILDING_KIND, type MapSiege } from '@open-northland/data';
import {
  Building,
  HaulFlag,
  HaulingCart,
  Position,
  Rider,
  Settler,
  Vehicle,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { Entity, World } from '../../ecs/world.js';
import { hexDistanceBetween, nodeOfPosition, positionOfNode } from '../../nav/halfcell.js';
import { anchorNodeOf } from '../ai-shared/node-geometry.js';
import { isBuilt, ownedBuildings, ownedSettlers } from '../ai-shared/seat-roster.js';
import { builderJobOf } from '../ai-shared/workforce/pool.js';
import type { SystemContext } from '../context.js';
import { bindHaulFlag, liveHaulFlag } from '../economy/work-flag.js';
import { assignedWorkers } from '../stores/assigned-workers.js';
import { isCarrierJob } from '../stores/index.js';
import { createVehicle } from '../vehicles/create.js';
import { canTakeHaulingCart, orderHaulingCart } from '../vehicles/hauling-cart.js';
import { vehicleIndex } from '../vehicles/registry.js';
import { removeVehicle } from '../vehicles/remove.js';
import { siegeTribe, spawnAtKeep, spawnPostedAtKeep } from './keep.js';

// The fortress's working crew, kept up on the guard refill beats the way the guard is: builders for the
// map AI's wall and house sites, and porters who cart the goods lying in the fortress into its store. The
// seat's own map-AI town pass and the settlers' planner give them their work.

type Builders = NonNullable<MapSiege['builders']>;
type Porters = NonNullable<MapSiege['porters']>;

/** Make the fortress seat's missing builders at the keep. */
export function keepBuilders(world: World, ctx: SystemContext, siege: MapSiege, builders: Builders): void {
  const jobType = builderJobOf(ctx);
  if (jobType === null) return;
  const seat = siege.stronghold.seat;
  let have = 0;
  for (const e of ownedSettlers(world, seat)) if (world.get(e, Settler).jobType === jobType) have++;
  for (; have < builders.count; have++) spawnAtKeep(world, ctx, siege, jobType, seat);
}

/**
 * Keep `count` porters at the fortress store: its posted carriers, the lowest ids first, made at the keep
 * into the free carrier posts when short. Each holds a flag at the porters' point with their radius and
 * pulls a hauling cart: a free one of the seat's when he has none, else a new one set beside him.
 */
export function keepPorters(world: World, ctx: SystemContext, siege: MapSiege, porters: Porters): void {
  const store = fortressStore(world, ctx, siege);
  if (store === null) return;
  const post = carrierPost(ctx, store.type);
  const anchor = anchorNodeOf(world, store.entity);
  if (post === null || anchor === null) return;
  const posted = assignedWorkers(world, store.entity).filter(
    (e) => world.tryGet(e, Settler)?.jobType === post.jobType,
  );
  const crew = posted.slice(0, porters.count);
  const room = Math.min(porters.count, post.count) - crew.length;
  for (let i = 0; i < room; i++) {
    const e = spawnPostedAtKeep(world, ctx, siege, post.jobType, store.entity, anchor);
    if (e === null) break;
    crew.push(e);
  }
  const vehicleType = contentIndex(ctx.content).vehicleTypeBySlug.get(porters.vehicle);
  for (const e of crew) {
    holdPorterFlag(world, ctx, e, porters);
    if (vehicleType !== undefined) handCart(world, ctx, siege, e, vehicleType);
  }
}

/** The fortress seat's finished storehouse nearest the keep, ties by entity. */
function fortressStore(
  world: World,
  ctx: SystemContext,
  siege: MapSiege,
): { entity: Entity; type: number } | null {
  const index = contentIndex(ctx.content);
  let best: { entity: Entity; type: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const e of ownedBuildings(world, siege.stronghold.seat)) {
    const type = world.get(e, Building).buildingType;
    if (index.buildings.get(type)?.kind !== BUILDING_KIND.storage || !isBuilt(world, e)) continue;
    const at = world.tryGet(e, Position);
    if (at === undefined) continue;
    const node = nodeOfPosition(at.x, at.y);
    const distance = hexDistanceBetween(node.hx, node.hy, siege.stronghold.x, siege.stronghold.y);
    if (distance < bestDistance) {
      best = { entity: e, type };
      bestDistance = distance;
    }
  }
  return best;
}

/** The store type's carrier post: its trade and how many it employs. */
function carrierPost(ctx: SystemContext, buildingType: number): { jobType: number; count: number } | null {
  const slots = contentIndex(ctx.content).buildings.get(buildingType)?.workers ?? [];
  return slots.find((slot) => isCarrierJob(ctx, slot.jobType)) ?? null;
}

/** Plant or move the porter's flag to the porters' point, and give it their radius. */
function holdPorterFlag(world: World, ctx: SystemContext, e: Entity, porters: Porters): void {
  const at = positionOfNode(porters.x, porters.y);
  const live = liveHaulFlag(world, e);
  const placed = live === undefined ? undefined : world.get(live.flag, Position);
  if (placed === undefined || placed.x !== at.x || placed.y !== at.y) bindHaulFlag(world, ctx, e, at);
  if (world.tryGet(e, HaulFlag)?.radius !== porters.radius) world.mut(e, HaulFlag).radius = porters.radius;
}

/**
 * Give a porter standing on the map without a cart the seat's free cart of the porters' type, the lowest id
 * first, so a dead porter's cart and its load go back to work; with none free, a new cart beside him. A
 * new one he could not take is taken back.
 */
function handCart(world: World, ctx: SystemContext, siege: MapSiege, e: Entity, vehicleType: number): void {
  const held = world.tryGet(e, HaulingCart);
  // A cart destroyed since leaves its binding until the puller next plans; the new one replaces it.
  if ((held !== undefined && world.has(held.vehicle, Vehicle)) || world.has(e, Rider)) return;
  const free = vehicleIndex(world)
    .ownedBy(siege.stronghold.seat)
    .find((v) => world.get(v, Vehicle).vehicleType === vehicleType && canTakeHaulingCart(world, ctx, e, v));
  if (free !== undefined) {
    orderHaulingCart(world, ctx, e, free);
    return;
  }
  const at = world.tryGet(e, Position);
  const tribe = siegeTribe(ctx, siege);
  if (at === undefined || tribe === undefined) return;
  const node = nodeOfPosition(at.x, at.y);
  const cart = createVehicle(world, ctx, {
    vehicleType,
    x: node.hx,
    y: node.hy,
    tribe,
    owner: siege.stronghold.seat,
  });
  if (cart === null) return;
  if (canTakeHaulingCart(world, ctx, e, cart)) orderHaulingCart(world, ctx, e, cart);
  else removeVehicle(world, ctx, cart, 'script');
}
