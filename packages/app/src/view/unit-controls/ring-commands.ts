import {
  type Entity,
  MAX_UNIT_ORDER_MEMBERS,
  type NeedKind,
  type PlayerCommand,
  systems,
  type UnitSelfAction,
} from '@open-northland/sim';
import type { ActionOrderId } from '../../hud/action-ring/index.js';
import { enqueueArmyOrder } from './group-orders.js';
import type { PickModeController } from './pick-mode.js';

export interface RingCommandDeps {
  readonly onOrderLimit?: (() => void) | undefined;
  readonly enqueue: (command: PlayerCommand) => void;
  readonly pickMode: PickModeController;
  /** Open the equipment-good picker for the settlers the order reaches. */
  readonly openEquipment: (settlers: readonly number[]) => void;
  /** Show or hide the work-area circle of every settler the order reaches that carries a work flag. */
  readonly toggleWorkArea: (targets: readonly number[]) => void;
  /** The selected siege vehicles, which the settler ring does not list but an attack-move marches too. */
  readonly siegeVehicles: () => readonly number[];
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
export function issueRingCommand(
  id: ActionOrderId,
  targets: readonly number[],
  deps: RingCommandDeps,
): boolean {
  if (targets.length === 0) return false; // the order's gate shut on every settler since the ring opened
  const single = targets.length === 1 ? targets[0] : undefined;
  const action = (action: UnitSelfAction): boolean =>
    enqueueArmyOrder(
      {
        kind: 'unitActionGroup',
        members: targets.map((entity) => ({ entity: entity as Entity })),
        action,
      },
      deps.enqueue,
      deps.onOrderLimit,
    );
  switch (id) {
    case 'goTo':
      deps.pickMode.arm({ kind: 'destination', units: targets });
      return true;
    case 'eat':
    case 'sleep':
    case 'talk':
    case 'pray':
      return action({ kind: 'orderNeed', need: NEED_OF[id] });
    case 'changeEquipment':
      if (targets.length > MAX_UNIT_ORDER_MEMBERS) {
        deps.onOrderLimit?.();
        return false;
      }
      deps.openEquipment(targets);
      return true;
    case 'showWorkArea':
      deps.toggleWorkArea(targets);
      return true;
    case 'explore':
      if (single !== undefined) deps.pickMode.arm({ kind: 'explore', scout: single });
      return true;
    case 'marry':
      return action({ kind: 'marry' });
    case 'haveBoy':
      return action({ kind: 'makeChild', child: 'male' });
    case 'haveGirl':
      return action({ kind: 'makeChild', child: 'female' });
    case 'assignWorkArea':
      deps.pickMode.arm({ kind: 'work-area', units: targets });
      return true;
    case 'erectSignpost':
      if (single !== undefined) deps.pickMode.arm({ kind: 'signpost', scout: single });
      return true;
    case 'assignBuildingSite':
      deps.pickMode.arm({ kind: 'building-site', units: targets });
      return true;
    case 'removeBuildingSite':
      return action({ kind: 'unassignBuilder' });
    case 'removeLearningPlace':
      return action({ kind: 'cancelTraining' });
    case 'assignLearningPlace':
      deps.pickMode.arm({ kind: 'learning-place', units: targets });
      return true;
    case 'removeWorkPlace':
      return action({ kind: 'unassignWorker' });
    case 'assignWorkPlace':
      deps.pickMode.arm({ kind: 'workplace', units: targets });
      return true;
    case 'removeHome':
      return action({ kind: 'unassignHouse' });
    case 'assignHome':
      deps.pickMode.arm({ kind: 'home', units: targets });
      return true;
    case 'attackInhabitants':
      deps.pickMode.arm({ kind: 'attack-settler', units: targets });
      return true;
    case 'attackBuilding':
      deps.pickMode.arm({ kind: 'attack-building', units: targets });
      return true;
    case 'attackAnimal':
      deps.pickMode.arm({ kind: 'attack-animal', units: targets });
      return true;
    case 'attackVehicle':
      deps.pickMode.arm({ kind: 'attack-vehicle', units: targets });
      return true;
    case 'attackPosition':
      deps.pickMode.arm({ kind: 'attack-move', units: targets, vehicles: deps.siegeVehicles() });
      return true;
    case 'attackMode':
    case 'defenceMode':
    case 'ignorantMode':
      return enqueueArmyOrder(
        {
          kind: 'setStanceGroup',
          members: targets.map((entity) => ({ entity: entity as Entity })),
          mode:
            id === 'attackMode'
              ? systems.MILITARY_MODE.ATTACK
              : id === 'defenceMode'
                ? systems.MILITARY_MODE.DEFEND
                : systems.MILITARY_MODE.IGNORE,
        },
        deps.enqueue,
        deps.onOrderLimit,
      );
    case 'allowRegeneration':
    case 'prohibitRegeneration':
      return enqueueArmyOrder(
        {
          kind: 'setRegenerationGroup',
          members: targets.map((entity) => ({ entity: entity as Entity })),
          enabled: id === 'allowRegeneration',
        },
        deps.enqueue,
        deps.onOrderLimit,
      );
    case 'assignVehicle':
      if (single !== undefined) deps.pickMode.arm({ kind: 'vehicle', settler: single });
      return true;
    case 'removeVehicle':
      return action({ kind: 'detachFromVehicle' });
    default: {
      const unreachable: never = id;
      throw new Error(`unhandled action command: ${String(unreachable)}`);
    }
  }
}
