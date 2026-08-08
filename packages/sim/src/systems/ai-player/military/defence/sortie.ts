import { Stance } from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { TerrainGraph } from '../../../../nav/terrain/index.js';
import { MILITARY_MODE } from '../../../readviews/index.js';
import { entityNode } from '../../../spatial/nodes.js';
import { spokenFor } from '../errand.js';
import type { Raider } from './threat.js';

/**
 * Throw the men kicking their heels at `raider`: an attack-move onto the node he stands on, so they cut
 * down whatever they meet on the way in and keep fighting once they arrive.
 *
 * Men still walking out an earlier order are left to it: an attack-move onto a raider who has since moved
 * two nodes is not worth restarting the run for, and the ones who arrive unemployed are picked up by the
 * next decision.
 */
export function sortieOrders(
  world: World,
  terrain: TerrainGraph,
  free: readonly Entity[],
  raider: Raider,
): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  const goal = terrain.nodeAtClamped(raider.x, raider.y);
  const reachable = terrain.componentOf(goal);
  for (const e of free) {
    if (terrain.componentOf(entityNode(world, terrain, e)) !== reachable) continue;
    if (spokenFor(world, e)) continue;
    // ATTACK before the walk, like a march order: a man sent home on DEFEND would blinker himself down to
    // the hold radius of wherever the run ended.
    if (world.tryGet(e, Stance)?.mode !== MILITARY_MODE.ATTACK) {
      commands.push({ kind: 'setStance', entity: e, mode: MILITARY_MODE.ATTACK });
    }
    commands.push({ kind: 'attackMoveUnit', entity: e, x: raider.x, y: raider.y });
  }
  return commands;
}
