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
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isBarracks } from '../readviews/index.js';
import { interactionCell } from '../settlers/targets/index.js';
import { BARRACKS_DRILL_TICKS, drillDoorOpen } from '../settlers/training.js';
import { navigationLimitFor } from '../signposts/index.js';
import { clearNavState } from '../spatial/nodes.js';
import { isTradeAssignable } from './guards.js';

/**
 * Send one owned settler to drill at a barracks — see the command doc. The handler validates and stamps
 * the {@link TrainingOrder} errand; the planner's drill rung (`settlers/training.ts`) walks it out.
 * Authoritative like the employment orders: the current action, route, player walk and construction-crew
 * membership are dropped so the recruit sets off this tick and its site stops counting it.
 *
 * The house must be a standing same-tribe, same-side barracks whose door is open to the settler — the same
 * confinement `assignWorker` applies, plus the failed-goal memo the drill rung itself reads, so an order
 * the rung would abandon next tick is refused instead of accepted and then dropped. Re-issuing the same
 * order is a no-op rather than a restart: a double right-click must not silently throw away the drill
 * already served.
 */
export function trainSoldier(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'trainSoldier' }>,
): void {
  const e = command.entity;
  const house = command.house;
  if (!isTradeAssignable(world, e)) return;
  if (!isBarracks(world, ctx, house)) return;
  if (world.get(e, Settler).tribe !== world.get(house, Building).tribe) return;
  if (!sameSide(world, e, house)) return;
  if (world.tryGet(e, TrainingOrder)?.house === house) return; // already drilling here
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: no door to walk to
  const door = interactionCell(world, ctx, terrain, house);
  if (!drillDoorOpen(world, ctx, e, door, navigationLimitFor(world, ctx.content, terrain, e))) return;
  world.add(e, TrainingOrder, { house, drillTicksLeft: BARRACKS_DRILL_TICKS });
  world.remove(e, CurrentAtomic);
  world.remove(e, DeferredOrder); // the drill executing now supersedes any earlier parked order
  world.remove(e, PlayerOrder);
  world.remove(e, EquipOrder); // and any equip errand, whose return spot this walk would invalidate
  world.remove(e, SiteAssignment); // a builder pulled to drill leaves its foundation's crew
  clearNavState(world, e);
}
