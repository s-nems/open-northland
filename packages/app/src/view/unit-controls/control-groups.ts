import type { ElevationField } from '@open-northland/render';
import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { isBuilding, isSettler, isVehicle, ownerPlayerOf } from '../../game/snapshot.js';
import {
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
  /** Member id → the number the map marks it with, for the first {@link NUMBERED_GROUPS} groups; a member
   *  of several shows the lowest. The same map until a group changes. */
  numbers(): ReadonlyMap<number, number>;
}

/** The groups whose members wear their number on the map; higher groups stay unmarked. */
export const NUMBERED_GROUPS: ReadonlyMap<ControlGroupAction, number> = new Map([
  ['controlGroup1', 1],
  ['controlGroup2', 2],
  ['controlGroup3', 3],
]);

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
  let numbers: Map<number, number> | null = null;

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
      numbers = new Map();
      for (const [action, number] of NUMBERED_GROUPS) {
        for (const id of groups.get(action) ?? []) if (!numbers.has(id)) numbers.set(id, number);
      }
      return numbers;
    },
  };
}
