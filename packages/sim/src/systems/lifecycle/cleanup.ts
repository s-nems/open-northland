import { Building, Health, Owner, Palisade, Position, Upgrading, Vehicle } from '../../components/index.js';
import { eventAt } from '../../core/events.js';
import type { ChangeFeed, Entity, World } from '../../ecs/world.js';
import { unbindWorkersOf } from '../command/placement.js';
import type { System, SystemContext } from '../context.js';
import { razedStockOf, scatterSpilledStock, spilledStockOf } from '../economy/goods-spill.js';
import { evictResidentsOf } from '../family/households.js';
import { retryFailedRoutes } from '../landscape/routes.js';
import { dropRallyPoint } from '../orders/rally-point.js';
import { releaseWallBreaches } from '../palisades/breach.js';
import { removePalisade } from '../palisades/index.js';
import { razeSalvageOf } from '../stores/index.js';
import { removeVehicle } from '../vehicles/remove.js';
import { reap } from './death.js';
import { holdRuinSpill } from './ruins.js';

/**
 * The entities that may hold a drained {@link Health} pool: every Health add or write since the last
 * pass, plus the drained ones the last pass left alive. A pool reaches 0 only through such a write.
 */
interface DrainWatch {
  readonly feed: ChangeFeed;
  /** Drained pools the last pass saw but did not destroy. */
  carried: Entity[];
}

const watches = new WeakMap<World, DrainWatch>();

/**
 * Destroy every entity whose {@link Health} pool has been drained to 0 and announce it with a
 * `settlerDied` event. Runs last in the schedule, so a hit landed earlier this tick is reaped before
 * anything downstream or the renderer's snapshot can observe a 0-HP entity.
 */
export const cleanupSystem: System = (world, ctx) => {
  // Collect-then-destroy: never `world.destroy` while iterating the store the scan reads, and in
  // ascending-id order so the `settlerDied` events render consumes are stable.
  const dead = drainedPools(world);
  for (const e of dead) {
    if (!world.isAlive(e)) continue; // a rider a sinking ship took down earlier in this loop
    // A drained building goes through the demolish path, not the settler-death path: it holds no
    // marriage, flag, or starvation state and must not fire a `settlerDied` stinger.
    if (world.has(e, Building)) razeBuilding(world, ctx, e);
    else if (world.has(e, Palisade)) razePalisade(world, ctx, e);
    else if (world.has(e, Vehicle)) removeVehicle(world, ctx, e, 'destroyed');
    else reap(world, ctx, e);
  }
  const watch = watches.get(world);
  if (watch !== undefined) watch.carried = dead.filter((e) => isDrained(world, e));
};

/** Ascending ids of every entity whose Health pool is at or below 0. */
function drainedPools(world: World): Entity[] {
  const dead: Entity[] = [];
  let watch = watches.get(world);
  let lost = watch === undefined;
  if (watch === undefined) {
    watch = { feed: world.watchChanges([Health], [Health]), carried: [] };
    watches.set(world, watch);
  } else {
    const seen = new Set<Entity>();
    for (const e of watch.carried) {
      if (isDrained(world, e)) {
        dead.push(e);
        seen.add(e);
      }
    }
    lost = watch.feed.drain((e) => {
      if (seen.has(e) || !isDrained(world, e)) return;
      dead.push(e);
      seen.add(e);
    });
  }
  if (lost) {
    dead.length = 0;
    for (const e of world.query(Health)) {
      // Intentional deviation from the original: a pool left at exactly 0 dies here, where the original's
      // regeneration lifts a fed person back to 1 before its death check.
      if (world.get(e, Health).hitpoints <= 0) dead.push(e);
    }
  }
  return dead.sort((a, b) => a - b);
}

function isDrained(world: World, e: Entity): boolean {
  const health = world.isAlive(e) ? world.tryGet(e, Health) : undefined;
  return health !== undefined && health.hitpoints <= 0;
}

/**
 * The teardown seam combat razing and the player's `demolish` command share: release every bound settler,
 * announce it, remove the building, and heap whatever was inside plus its {@link razeSalvageOf} materials
 * on the ground where it stood partway through its collapse. The event is emitted before the destroy so the
 * entity's `Owner`, `Position`, and `Building` are still readable.
 */
export function razeBuilding(world: World, ctx: SystemContext, e: Entity): void {
  const owner = world.tryGet(e, Owner);
  const pos = world.tryGet(e, Position);
  const building = world.get(e, Building);
  ctx.events.emit({
    kind: 'buildingDestroyed',
    entity: e,
    player: owner?.player ?? null,
    buildingType: building.buildingType,
    tribe: building.tribe,
    built: building.built,
    ...(world.has(e, Upgrading) ? { upgrading: true } : {}),
    ...(pos !== undefined ? { at: eventAt(pos.x, pos.y) } : {}),
  });
  const spill = razedStockOf(world, ctx, e, razeSalvageOf(world, ctx, e));
  removeBuildingSilently(world, ctx, e);
  holdRuinSpill(world, ctx, spill);
}

/** Destroy a building and release every settler bound to it: its workers and the families living in it.
 *  The razing path layers the event and the spilled stock on top of this. */
export function removeBuildingSilently(world: World, ctx: SystemContext, e: Entity): void {
  releaseWallBreaches(world, ctx, e);
  dropRallyPoint(world, e);
  unbindWorkersOf(world, ctx, e);
  evictResidentsOf(world, e);
  world.destroy(e);
  if (ctx.terrain !== undefined) retryFailedRoutes(world, ctx.terrain);
}

/** Shared combat and owner-demolition teardown for a palisade or gate. */
export function razePalisade(world: World, ctx: SystemContext, e: Entity): void {
  if (!world.has(e, Palisade)) return;
  const spill = spilledStockOf(world, e);
  removePalisade(world, ctx, e);
  scatterSpilledStock(world, ctx, spill);
}
