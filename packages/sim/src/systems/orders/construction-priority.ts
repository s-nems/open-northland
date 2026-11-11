import { Building, UnderConstruction } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';

/** Prioritize one owned construction site - see the command doc. Only a raised building site takes
 *  a rank, so a wall segment, a road site and a standing building refuse; `normal` clears the rank.
 *  Never refused into an error, only ignored. */
export function setConstructionPriority(
  world: World,
  _ctx: SystemContext,
  command: Extract<Command, { kind: 'setConstructionPriority' }>,
): void {
  if (!world.has(command.building, Building)) return;
  const site = world.tryMut(command.building, UnderConstruction);
  if (site === undefined) return;
  // `normal` clears the field; a same-rank order mutates nothing, so caches never churn.
  if ((site.priority ?? 'normal') === command.priority) return;
  site.priority = command.priority === 'normal' ? undefined : command.priority;
}
