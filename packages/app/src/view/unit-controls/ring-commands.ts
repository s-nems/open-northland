import { type Entity, type PlayerCommand, systems } from '@open-northland/sim';
import type { ActionOrderId } from '../../hud/action-ring/index.js';
import type { PickModeController } from './pick-mode.js';

export interface RingCommandDeps {
  readonly enqueue: (command: PlayerCommand) => void;
  readonly pickMode: PickModeController;
}

/**
 * Turn one action-ring click into simulation orders for `targets`: an order that needs a world click
 * arms the matching pick mode, the rest issue at once. A single-settler order arrives with one target,
 * because the ring hides it from a larger selection.
 */
export function issueRingCommand(id: ActionOrderId, targets: readonly number[], deps: RingCommandDeps): void {
  const single = targets.length === 1 ? targets[0] : undefined;
  const each = (order: (entity: Entity) => PlayerCommand): void => {
    for (const target of targets) deps.enqueue(order(target as Entity));
  };
  switch (id) {
    case 'goTo':
      deps.pickMode.arm({ kind: 'destination' });
      return;
    case 'marry':
      each((entity) => ({ kind: 'marry', entity }));
      return;
    case 'haveBoy':
      each((entity) => ({ kind: 'makeChild', entity, child: 'male' }));
      return;
    case 'haveGirl':
      each((entity) => ({ kind: 'makeChild', entity, child: 'female' }));
      return;
    case 'assignWorkArea':
      deps.pickMode.arm({ kind: 'work-area' });
      return;
    case 'erectSignpost':
      if (single !== undefined) deps.pickMode.arm({ kind: 'signpost', scout: single });
      return;
    case 'assignBuildingSite':
      if (single !== undefined) deps.pickMode.arm({ kind: 'building-site', settler: single });
      return;
    case 'assignLearningPlace':
      if (single !== undefined) deps.pickMode.arm({ kind: 'learning-place', settler: single });
      return;
    case 'removeWorkPlace':
      each((entity) => ({ kind: 'unassignWorker', entity }));
      return;
    case 'assignWorkPlace':
      if (single !== undefined) deps.pickMode.arm({ kind: 'workplace', settler: single });
      return;
    case 'removeHome':
      each((entity) => ({ kind: 'unassignHouse', entity }));
      return;
    case 'assignHome':
      if (single !== undefined) deps.pickMode.arm({ kind: 'home', settler: single });
      return;
    case 'attackInhabitants':
      deps.pickMode.arm({ kind: 'attack-settler' });
      return;
    case 'attackBuilding':
      deps.pickMode.arm({ kind: 'attack-building' });
      return;
    case 'attackPosition':
      deps.pickMode.arm({ kind: 'attack-move' });
      return;
    case 'attackMode':
      each((entity) => ({ kind: 'setStance', entity, mode: systems.MILITARY_MODE.ATTACK }));
      return;
    case 'defenceMode':
      each((entity) => ({ kind: 'setStance', entity, mode: systems.MILITARY_MODE.DEFEND }));
      return;
    case 'ignorantMode':
      each((entity) => ({ kind: 'setStance', entity, mode: systems.MILITARY_MODE.IGNORE }));
      return;
    default: {
      const unreachable: never = id;
      throw new Error(`unhandled action command: ${String(unreachable)}`);
    }
  }
}
