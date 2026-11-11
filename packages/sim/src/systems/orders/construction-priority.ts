import { Building, UnderConstruction } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';

/** Mark or unmark a building site as prioritized; anything else ignores the order. */
export function setConstructionPriority(
  world: World,
  _ctx: SystemContext,
  command: Extract<Command, { kind: 'setConstructionPriority' }>,
): void {
  if (!world.has(command.building, Building)) return;
  const site = world.tryMut(command.building, UnderConstruction);
  if (site === undefined) return;
  if ((site.prioritized === true) === command.prioritized) return;
  site.prioritized = command.prioritized ? true : undefined;
}
