import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { isBuilding, isSettler, ownerPlayerOf } from '../../game/snapshot.js';
import {
  CONTROL_GROUP_BINDING_ACTIONS,
  type ControlGroupAction,
  type ControlGroupMode,
  controlGroupBinding,
  type KeyBindings,
  matchesKeyboardBinding,
} from '../../hud/keybindings.js';

export type ControlGroupCommand = Readonly<{
  action: ControlGroupAction;
  mode: ControlGroupMode;
}>;

interface ControlGroupKeyPress {
  readonly code: string;
  readonly repeat: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

/** Resolve an exact, configurable control-group chord. */
export function controlGroupCommand(
  event: ControlGroupKeyPress,
  bindings: KeyBindings,
): ControlGroupCommand | null {
  if (event.repeat) return null;
  const action = CONTROL_GROUP_BINDING_ACTIONS.find((candidate) =>
    matchesKeyboardBinding(event as KeyboardEvent, bindings[candidate]),
  );
  if (action === undefined) return null;
  const resolved = controlGroupBinding(action);
  return { action: resolved.group, mode: resolved.mode };
}

export interface ControlGroups {
  replace(action: ControlGroupAction, ids: Iterable<number>): void;
  /** Add these members here and remove them from every other group. */
  addExclusive(action: ControlGroupAction, ids: Iterable<number>): void;
  /** Current valid members, or null when the group cannot change the selection. */
  recall(action: ControlGroupAction, isSelectable: (id: number) => boolean): readonly number[] | null;
}

/** Group recall may reach off-screen actors, but never dead, foreign, neutral, or livestock entities. */
export function isControlGroupMember(
  snapshot: WorldSnapshot,
  ref: number,
  humanPlayer: number,
  observer: boolean,
): boolean {
  const entity = entityById(snapshot, ref);
  if (entity === undefined || (!isSettler(entity) && !isBuilding(entity))) return false;
  if (entity.components.Livestock !== undefined) return false;
  const owner = ownerPlayerOf(entity);
  return owner !== undefined && (observer || owner === humanPlayer);
}

/** Ten client-local selection groups. Invalid members are forgotten when their group is recalled. */
export function createControlGroups(): ControlGroups {
  const groups = new Map<ControlGroupAction, Set<number>>();

  return {
    replace: (action, ids) => groups.set(action, new Set(ids)),
    addExclusive: (action, ids) => {
      const moving = new Set(ids);
      if (moving.size === 0) return;
      for (const [otherAction, otherGroup] of groups) {
        if (otherAction === action) continue;
        for (const id of moving) otherGroup.delete(id);
      }
      const group = groups.get(action) ?? new Set<number>();
      for (const id of moving) group.add(id);
      groups.set(action, group);
    },
    recall: (action, isSelectable) => {
      const group = groups.get(action);
      if (group === undefined || group.size === 0) return null;
      const valid: number[] = [];
      for (const id of group) {
        if (isSelectable(id)) valid.push(id);
        else group.delete(id);
      }
      return valid.length === 0 ? null : valid;
    },
  };
}
