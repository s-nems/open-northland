import {
  Building,
  Health,
  isWildlife,
  Marriage,
  Owner,
  Position,
  recordHumanDeath,
  Settler,
  Upgrading,
  Wedding,
} from '../../components/index.js';
import { eventAt } from '../../core/events.js';
import { type Fixed, ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { unbindWorkersOf } from '../command/placement.js';
import type { System, SystemContext } from '../context.js';
import { droppedEquipmentOf, scatterSpilledStock, spilledStockOf } from '../economy/goods-spill.js';
import { removeWorkFlag } from '../economy/work-flag.js';
import { isMinor } from '../family/households.js';
import { releaseWidowedParentsOf, settleWidowhood } from '../family/widowhood.js';
import { isSoldierJob } from '../readviews/index.js';

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
    // A drained building goes through the demolish path, not the settler-death path: it holds no
    // marriage, flag, or starvation state and must not fire a `settlerDied` stinger.
    if (world.has(e, Building)) razeBuilding(world, ctx, e);
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
  unbindWorkersOf(world, ctx, e);
  const spill = spilledStockOf(world, e);
  world.destroy(e);
  scatterSpilledStock(world, ctx, spill);
}

/** Announce a combatant's death, count it against its owner, remove it from the world, and leave its
 *  gear on the ground where it fell. The event is emitted before the destroy so its `Owner` and
 *  `Position` are still readable. */
function reap(world: World, ctx: SystemContext, e: Entity): void {
  const owner = world.tryGet(e, Owner);
  const pos = world.tryGet(e, Position);
  const settler = world.tryGet(e, Settler);
  const animal = isWildlife(world, e);
  ctx.events.emit({
    kind: 'settlerDied',
    entity: e,
    cause: causeOf(settler),
    player: owner?.player ?? null,
    ...(animal ? { animal: true } : {}),
    ...(pos !== undefined ? { at: eventAt(pos.x, pos.y) } : {}),
  });
  if (!animal) recordHumanDeath(world, owner?.player, isSoldierJob(ctx.content, settler?.jobType ?? null));
  const loot = droppedEquipmentOf(world, e);
  removeSettlerSilently(world, e);
  scatterSpilledStock(world, ctx, loot);
}

/** Destroy a settler and settle every binding it leaves dangling. The reaper layers the death event,
 *  the statistics and the dropped gear on top of this. */
export function removeSettlerSilently(world: World, e: Entity): void {
  removeWorkFlag(world, e); // a work flag has no owner once its gatherer is gone
  const marriage = world.tryGet(e, Marriage);
  const wedding = world.tryGet(e, Wedding);
  const wasMinor = isMinor(world, e);
  world.destroy(e);
  // The widowing rule needs the decedent already dead, so it settles after the destroy; a dying minor
  // is the other trigger that expires a widowed parent's carve-out.
  if (marriage !== undefined && world.isAlive(marriage.spouse)) settleWidowhood(world, marriage.spouse);
  if (wedding !== undefined && world.isAlive(wedding.partner)) world.remove(wedding.partner, Wedding);
  if (wasMinor) releaseWidowedParentsOf(world, e);
}

/** A render/audio hint, not simulated state: hunger pinned at ONE reads as starvation, everything else as
 *  combat damage. A swing that kills a settler already pinned is the accepted ambiguity. */
function causeOf(settler: { hunger: Fixed } | undefined): string {
  return settler !== undefined && settler.hunger === ONE ? DEATH_CAUSE_STARVATION : DEATH_CAUSE_DAMAGE;
}

const DEATH_CAUSE_DAMAGE = 'damage';
const DEATH_CAUSE_STARVATION = 'starvation';
