import type { ElevationField } from '@open-northland/render';
import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { isBuilding, isSettler, isVehicle, ownerPlayerOf } from '../../game/snapshot.js';
import {
  CONTROL_GROUP_ACTIONS,
  CONTROL_GROUP_BINDING_ACTIONS,
  type ControlGroupAction,
  type ControlGroupMode,
  controlGroupBinding,
  type KeyBindings,
  type KeyPress,
  matchesKeyboardBinding,
} from '../../hud/keybindings.js';
import { entityAnchor } from '../projections/entity-anchor.js';
import { type IsUnit, selectionAfter } from './selection.js';

export type ControlGroupCommand = Readonly<{
  action: ControlGroupAction;
  mode: ControlGroupMode;
}>;

type ControlGroupKeyPress = KeyPress & Pick<KeyboardEvent, 'repeat'>;

/** Resolve an exact, configurable control-group chord. */
export function controlGroupCommand(
  event: ControlGroupKeyPress,
  bindings: KeyBindings,
): ControlGroupCommand | null {
  if (event.repeat) return null;
  const action = CONTROL_GROUP_BINDING_ACTIONS.find((candidate) =>
    matchesKeyboardBinding(event, bindings[candidate]),
  );
  if (action === undefined) return null;
  const resolved = controlGroupBinding(action);
  return { action: resolved.group, mode: resolved.mode };
}

export interface ControlGroups {
  replace(action: ControlGroupAction, ids: Iterable<number>): void;
  /** Add these members here and remove them from every other group. */
  addExclusive(action: ControlGroupAction, ids: Iterable<number>): void;
  /** Current valid members, or null when the group cannot change the selection. A group holds units
   *  or one building; stored members that mix the two recall the units. */
  recall(
    action: ControlGroupAction,
    isSelectable: (id: number) => boolean,
    isUnit: IsUnit,
  ): readonly number[] | null;
  /** Member id → the numbers of its groups the map marks it with, in group order, the first
   *  {@link MAX_LABELLED_GROUPS} of them. The same map until a group changes. */
  numbers(): ReadonlyMap<number, readonly string[]>;
}

/** Each group's own number, independent of the key it is bound to. */
const GROUP_NUMBERS: Readonly<Record<ControlGroupAction, string>> = {
  controlGroup1: '1',
  controlGroup2: '2',
  controlGroup3: '3',
  controlGroup4: '4',
  controlGroup5: '5',
  controlGroup6: '6',
  controlGroup7: '7',
  controlGroup8: '8',
  controlGroup9: '9',
  controlGroup0: '0',
};

/** A member of more groups shows only the first this many. */
const MAX_LABELLED_GROUPS = 3;

/** Centre only when the current selection contains exactly the recalled group. */
export function groupRecallEffect(
  ids: readonly number[],
  selected: ReadonlySet<number>,
): 'centre' | 'select' {
  return ids.length === selected.size && ids.every((id) => selected.has(id)) ? 'centre' : 'select';
}

/** The world-px centroid of the members' ground anchors (the mean the original's group position takes),
 *  or null when none is positioned. */
export function groupCentre(
  snapshot: WorldSnapshot,
  ids: readonly number[],
  elevation?: ElevationField,
): { x: number; y: number } | null {
  let x = 0;
  let y = 0;
  let count = 0;
  for (const id of ids) {
    const at = entityAnchor(snapshot, id, elevation);
    if (at === null) continue;
    x += at.x;
    y += at.y;
    count++;
  }
  return count === 0 ? null : { x: x / count, y: y / count };
}

/** Group recall may reach off-screen actors, but never dead, foreign, neutral, or livestock entities;
 *  a whole-map viewer (`seat` null) owns them all. */
export function isControlGroupMember(snapshot: WorldSnapshot, ref: number, seat: number | null): boolean {
  const entity = entityById(snapshot, ref);
  if (entity === undefined || (!isSettler(entity) && !isBuilding(entity) && !isVehicle(entity))) return false;
  if (entity.components.Livestock !== undefined) return false;
  const owner = ownerPlayerOf(entity);
  return owner !== undefined && (seat === null || owner === seat);
}

/** Ten client-local selection groups. Invalid members are forgotten when their group is recalled. */
export function createControlGroups(): ControlGroups {
  const groups = new Map<ControlGroupAction, Set<number>>();
  let numbers: Map<number, string[]> | null = null;

  return {
    replace: (action, ids) => {
      groups.set(action, new Set(ids));
      numbers = null;
    },
    addExclusive: (action, ids) => {
      const moving = new Set(ids);
      if (moving.size === 0) return;
      numbers = null;
      for (const [otherAction, otherGroup] of groups) {
        if (otherAction === action) continue;
        for (const id of moving) otherGroup.delete(id);
      }
      const group = groups.get(action) ?? new Set<number>();
      for (const id of moving) group.add(id);
      groups.set(action, group);
    },
    recall: (action, isSelectable, isUnit) => {
      const group = groups.get(action);
      if (group === undefined || group.size === 0) return null;
      const valid: number[] = [];
      for (const id of group) {
        if (isSelectable(id)) valid.push(id);
        else {
          group.delete(id);
          numbers = null;
        }
      }
      return valid.length === 0 ? null : selectionAfter([], valid, false, isUnit);
    },
    numbers: () => {
      if (numbers !== null) return numbers;
      const built = new Map<number, string[]>();
      for (const action of CONTROL_GROUP_ACTIONS) {
        for (const id of groups.get(action) ?? []) {
          const listed = built.get(id) ?? [];
          if (listed.length < MAX_LABELLED_GROUPS) listed.push(GROUP_NUMBERS[action]);
          built.set(id, listed);
        }
      }
      numbers = built;
      return built;
    },
  };
}
