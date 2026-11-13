import type { Command } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { liftStorePriority, markStorePriority, noteBarracksPriorityLifted } from '../stores/index.js';

/** Mark or unmark one good as priority in a store - see the command doc. */
export function setStorePriority(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setStorePriority' }>,
): void {
  const { building, goodType } = command;
  if (!world.isAlive(building)) return;
  if (command.priority) markStorePriority(world, ctx, building, goodType);
  else if (liftStorePriority(world, building, goodType))
    noteBarracksPriorityLifted(world, ctx, building, goodType);
}
