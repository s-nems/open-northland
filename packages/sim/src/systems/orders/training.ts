import {
  Building,
  CurrentAtomic,
  DeferredOrder,
  EquipOrder,
  PlayerOrder,
  Settler,
  SiteAssignment,
  sameSide,
  TrainingOrder,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isBarracks } from '../readviews/index.js';
import { BARRACKS_DRILL_TICKS, drillDoorOpen } from '../settlers/drives/training.js';
import { interactionCell } from '../settlers/targets/index.js';
import { navigationLimitFor } from '../signposts/index.js';
import { clearNavState } from '../spatial/nodes.js';
import { isTradeAssignable } from './guards.js';

/**
 * Send one owned settler to drill at a barracks: validate and stamp the {@link TrainingOrder} errand for
 * the planner's drill rung to walk out. Authoritative like the employment orders, so the current action,
 * route, player walk, and construction-crew membership are dropped.
 *
 * The gate reads the same confinement `assignWorker` applies plus the failed-goal memo the drill rung
 * itself reads, so an order the rung would abandon next tick is refused rather than accepted and dropped.
 * Re-issuing the same order is a no-op, because a double right-click must not throw away drill already
 * served.
 */
export function trainSoldier(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'trainSoldier' }>,
): void {
  if (!mayDrillAt(world, ctx, command.entity, command.house)) return;
  startDrill(world, command.entity, command.house, BARRACKS_DRILL_TICKS);
}

/**
 * Whether `e` may be sent to drill at `house` right now, shared with the assistant's training dispatcher so
 * an auto-issued drill obeys exactly the player order's gates.
 */
export function mayDrillAt(world: World, ctx: SystemContext, e: Entity, house: Entity): boolean {
  if (!isTradeAssignable(world, e)) return false;
  if (!isBarracks(world, ctx, house)) return false;
  if (world.get(e, Settler).tribe !== world.get(house, Building).tribe) return false;
  if (!sameSide(world, e, house)) return false;
  if (world.tryGet(e, TrainingOrder)?.house === house) return false; // already drilling here
  const terrain = ctx.terrain;
  if (terrain === undefined) return false; // mapless sim: no door to walk to
  const door = interactionCell(world, ctx, terrain, house);
  return drillDoorOpen(world, ctx, e, door, navigationLimitFor(world, ctx.content, terrain, e));
}

/** Stamp the drill errand and drop what it supersedes, the accepting half of {@link trainSoldier} once
 *  {@link mayDrillAt} passed. `drillTicks` is the caller's serving length. */
export function startDrill(world: World, e: Entity, house: Entity, drillTicks: number): void {
  world.add(e, TrainingOrder, { house, drillTicksLeft: drillTicks });
  world.remove(e, CurrentAtomic);
  world.remove(e, DeferredOrder); // the drill executing now supersedes any earlier parked order
  world.remove(e, PlayerOrder);
  world.remove(e, EquipOrder); // and any equip errand, whose return spot this walk would invalidate
  world.remove(e, SiteAssignment); // a builder pulled to drill leaves its foundation's crew
  clearNavState(world, e);
}
