import { diplomacyLocked, setDiplomacyStance } from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { World } from '../../ecs/world.js';

/**
 * A seat's own stance change. A locked pair is refused here, where the original only withholds the
 * window's stance buttons and runs whatever command 0x7f arrives: a
 * network seat cannot get past the sim the way it could past a window.
 */
export function declareDiplomacy(
  world: World,
  command: Extract<Command, { kind: 'declareDiplomacy' }>,
): void {
  const { player, other, state } = command;
  if (player === other || diplomacyLocked(world, player, other)) return;
  setDiplomacyStance(world, player, other, state);
}
