import { type Entity, type NeedKind, type PlayerCommand, systems } from '@open-northland/sim';
import type { ActionOrderId } from '../../hud/action-ring/index.js';
import type { PickModeController } from './pick-mode.js';

export interface RingCommandDeps {
  readonly enqueue: (command: PlayerCommand) => void;
  readonly pickMode: PickModeController;
  /** Open the equipment-good picker for the settlers the order reaches. */
  readonly openEquipment: (settlers: readonly number[]) => void;
  /** Show or hide the work-area circle of every settler the order reaches that carries a work flag. */
  readonly toggleWorkArea: (targets: readonly number[]) => void;
}

/** Which need bar each of the original's four need buttons orders answered. */
const NEED_OF: Readonly<Record<'eat' | 'sleep' | 'talk' | 'pray', NeedKind>> = {
  eat: 'hunger',
  sleep: 'fatigue',
  talk: 'enjoyment',
  pray: 'piety',
};

/**
 * Turn one action-ring click into simulation orders for `targets`, the selected settlers that allow the
 * order: an order that needs a world click arms the matching pick mode, the rest issue at once. A
 * single-settler order arrives with one target, because the ring hides it from a larger selection.
 */
export function issueRingCommand(id: ActionOrderId, targets: readonly number[], deps: RingCommandDeps): void {
  if (targets.length === 0) return; // the order's gate shut on every settler since the ring opened
  const single = targets.length === 1 ? targets[0] : undefined;
  const each = (order: (entity: Entity) => PlayerCommand): void => {
    for (const target of targets) deps.enqueue(order(target as Entity));
  };
  switch (id) {
    case 'goTo':
      deps.pickMode.arm({ kind: 'destination', units: targets });
      return;
    case 'eat':
    case 'sleep':
    case 'talk':
    case 'pray':
      each((entity) => ({ kind: 'orderNeed', entity, need: NEED_OF[id] }));
      return;
    case 'changeEquipment':
      deps.openEquipment(targets);
      return;
    case 'showWorkArea':
      deps.toggleWorkArea(targets);
      return;
    case 'explore':
      if (single !== undefined) deps.pickMode.arm({ kind: 'explore', scout: single });
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
      deps.pickMode.arm({ kind: 'work-area', units: targets });
      return;
    case 'erectSignpost':
      if (single !== undefined) deps.pickMode.arm({ kind: 'signpost', scout: single });
      return;
    case 'assignBuildingSite':
      deps.pickMode.arm({ kind: 'building-site', units: targets });
      return;
    case 'removeBuildingSite':
      each((entity) => ({ kind: 'unassignBuilder', entity }));
      return;
    case 'removeLearningPlace':
      each((entity) => ({ kind: 'cancelTraining', entity }));
      return;
    case 'assignLearningPlace':
      deps.pickMode.arm({ kind: 'learning-place', units: targets });
      return;
    case 'removeWorkPlace':
      each((entity) => ({ kind: 'unassignWorker', entity }));
      return;
    case 'assignWorkPlace':
      deps.pickMode.arm({ kind: 'workplace', units: targets });
      return;
    case 'removeHome':
      each((entity) => ({ kind: 'unassignHouse', entity }));
      return;
    case 'assignHome':
      deps.pickMode.arm({ kind: 'home', units: targets });
      return;
    case 'attackInhabitants':
      deps.pickMode.arm({ kind: 'attack-settler', units: targets });
      return;
    case 'attackBuilding':
      deps.pickMode.arm({ kind: 'attack-building', units: targets });
      return;
    case 'attackAnimal':
      deps.pickMode.arm({ kind: 'attack-animal', units: targets });
      return;
    case 'attackVehicle':
      deps.pickMode.arm({ kind: 'attack-vehicle', units: targets });
      return;
    case 'attackPosition':
      deps.pickMode.arm({ kind: 'attack-move', units: targets });
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
    case 'allowRegeneration':
      each((entity) => ({ kind: 'setRegeneration', entity, enabled: true }));
      return;
    case 'prohibitRegeneration':
      each((entity) => ({ kind: 'setRegeneration', entity, enabled: false }));
      return;
    case 'assignVehicle':
      if (single !== undefined) deps.pickMode.arm({ kind: 'vehicle', settler: single });
      return;
    default: {
      const unreachable: never = id;
      throw new Error(`unhandled action command: ${String(unreachable)}`);
    }
  }
}
