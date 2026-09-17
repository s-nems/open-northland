import { Building, Health, Owner, Palisade, Position, Upgrading, Vehicle } from '../../components/index.js';
import { eventAt } from '../../core/events.js';
import type { Entity, World } from '../../ecs/world.js';
import { unbindWorkersOf } from '../command/placement.js';
import type { System, SystemContext } from '../context.js';
import { scatterSpilledStock, spilledStockOf } from '../economy/goods-spill.js';
import { evictResidentsOf } from '../family/households.js';
import { releaseWallBreaches } from '../palisades/breach.js';
import { removeVehicle } from '../vehicles/remove.js';
import { reap } from './death.js';

/**
 * Destroy every entity whose {@link Health} pool has been drained to 0 and announce it with a
 * `settlerDied` event. Runs last in the schedule, so a hit landed earlier this tick is reaped before
 * anything downstream or the renderer's snapshot can observe a 0-HP entity.
 */
export const cleanupSystem: System = (world, ctx) => {
  // Collect-then-destroy: never `world.destroy` while iterating the store the scan reads, and in
  // ascending-id order so the `settlerDied` events render consumes are stable.
  const dead: Entity[] = [];
  for (const e of world.query(Health)) {
    if (world.get(e, Health).hitpoints <= 0) dead.push(e);
  }
  dead.sort((a, b) => a - b);
  for (const e of dead) {
    if (!world.isAlive(e)) continue; // a rider a sinking ship took down earlier in this loop
    // A drained building goes through the demolish path, not the settler-death path: it holds no
    // marriage, flag, or starvation state and must not fire a `settlerDied` stinger.
    if (world.has(e, Building)) razeBuilding(world, ctx, e);
    else if (world.has(e, Palisade)) razePalisade(world, ctx, e);
    else if (world.has(e, Vehicle)) removeVehicle(world, ctx, e, 'destroyed');
    else reap(world, ctx, e);
  }
};

/**
 * The teardown seam combat razing and the player's `demolish` command share: release every bound settler,
 * announce it, remove the building, and heap whatever was inside on the ground where it stood. The event
 * is emitted before the destroy so the entity's `Owner`, `Position`, and `Building` are still readable.
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
  const spill = spilledStockOf(world, e);
  removeBuildingSilently(world, ctx, e);
  scatterSpilledStock(world, ctx, spill);
}

/** Destroy a building and release every settler bound to it: its workers and the families living in it.
 *  The razing path layers the event and the spilled stock on top of this. */
export function removeBuildingSilently(world: World, ctx: SystemContext, e: Entity): void {
  unbindWorkersOf(world, ctx, e);
  evictResidentsOf(world, e);
  world.destroy(e);
}

/** Shared combat and owner-demolition teardown for a palisade or gate. */
export function razePalisade(world: World, ctx: SystemContext, e: Entity): void {
  if (!world.has(e, Palisade)) return;
  const spill = spilledStockOf(world, e);
  releaseWallBreaches(world, ctx, e);
  world.destroy(e);
  scatterSpilledStock(world, ctx, spill);
}
