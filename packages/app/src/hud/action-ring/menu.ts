import { ACTION_COMMANDS, type ActionCommand, type ActionCommandId } from './commands.js';
import type { ActionArm, ActionGroup } from './layout.js';

/** The arms a selection's `allowed` orders draw; an arm no allowed order sits on is dropped. */
export function actionRingMenu(allowed: ReadonlySet<ActionCommandId>): readonly ActionGroup[] {
  const byArm = new Map<ActionArm, ActionCommand[]>();
  for (const command of ACTION_COMMANDS) {
    if (!allowed.has(command.id)) continue;
    const commands = byArm.get(command.arm);
    if (commands === undefined) byArm.set(command.arm, [command]);
    else commands.push(command);
  }
  return [...byArm].map(([arm, commands]) => ({ arm, commands }));
}
