import {
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  NoRegeneration,
  Settler,
} from '../../../../components/index.js';
import type { PlayerCommand } from '../../../../core/commands/index.js';
import type { World } from '../../../../ecs/world.js';
import type { SystemContext } from '../../../context.js';
import { isFighterJob } from '../../../readviews/index.js';
import { ownedSettlers } from '../../seat-roster.js';

/**
 * Enlist the seat's fighters as the scripted handler's soldiers. Byte evidence: the original's handler
 * lists every soldier of the seat that mans no workhouse, rides no vehicle and stands within the
 * player's control (`MISSIONS.md`, behaviour bit 5), and a man joining the list gets two commands,
 * the hold stance and a cleared regenerate-in-world flag. Only the flag is issued here: a listed man
 * never walks off to eat or sleep, so a garrison stays where its map or its orders put it, and his bars
 * fall to the seat's minute refill instead. The flag is written over a tower's garrison too, since
 * this build's posting order re-idles the man as his own trade and lifts it, where the original's
 * flag outlives the walk into the tower. The stance is left at the fighter default (approximation:
 * the original's hold stance fires at what enters the weapon's reach without moving, which this
 * build's stances do not model).
 */
export function enlistOrders(world: World, ctx: SystemContext, player: number): PlayerCommand[] {
  const commands: PlayerCommand[] = [];
  for (const e of ownedSettlers(world, player)) {
    const jobType = world.get(e, Settler).jobType;
    if (jobType === null || !isFighterJob(ctx.content, jobType)) continue;
    if (world.has(e, NoRegeneration) || hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.NOT_CONTROLLABLE))
      continue;
    commands.push({ kind: 'setRegeneration', entity: e, enabled: false });
  }
  return commands;
}
