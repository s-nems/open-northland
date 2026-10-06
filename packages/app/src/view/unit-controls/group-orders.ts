import {
  type GroupActions,
  MAX_UNIT_MEMBER_ACTIONS,
  MAX_UNIT_ORDER_MEMBERS,
  type PlayerCommand,
  type UnitSelectionAction,
  type UnitSelectionCommand,
} from '@open-northland/sim';

type ArmyCommand = Extract<
  PlayerCommand,
  {
    kind:
      | 'setVehicleStanceGroup'
      | 'moveVehicleGroup'
      | 'attackWithVehicleGroup'
      | 'moveUnitGroup'
      | 'attackMoveUnitGroup'
      | 'attackUnitGroup'
      | 'setStanceGroup'
      | 'setRegenerationGroup'
      | 'unitActionGroup'
      | 'unitOrdersGroup';
  }
>;

/** One selection action stays one envelope; oversized gestures are refused whole. */
export function enqueueArmyOrder(
  command: ArmyCommand,
  enqueue: (command: PlayerCommand) => void,
  onLimit?: () => void,
): boolean {
  if (command.members.length > MAX_UNIT_ORDER_MEMBERS) {
    onLimit?.();
    return false;
  }
  const first = command.members[0];
  if (first === undefined) return false;
  if (command.members.length > 1) {
    enqueue(command);
    return true;
  }
  if (command.kind === 'unitOrdersGroup') {
    const member = command.members[0];
    if (member === undefined) return false;
    const action = member.actions[0];
    if (member.actions.length === 1 && action !== undefined) enqueue({ ...action, entity: member.entity });
    else enqueue(command);
    return true;
  }
  const entity = first.entity;
  switch (command.kind) {
    case 'setVehicleStanceGroup':
      enqueue({ kind: 'setVehicleStance', vehicle: entity, stance: command.stance });
      break;
    case 'moveVehicleGroup': {
      const destination = command.members[0];
      if (destination === undefined) return false;
      enqueue({
        kind: 'moveVehicle',
        vehicle: destination.entity,
        x: destination.x,
        y: destination.y,
        ...(command.attackMove ? { attackMove: true } : {}),
      });
      break;
    }
    case 'attackWithVehicleGroup':
      enqueue({ kind: 'attackWithVehicle', vehicle: entity, target: command.target });
      break;
    case 'moveUnitGroup':
    case 'attackMoveUnitGroup': {
      const destination = command.members[0];
      if (destination === undefined) return false;
      enqueue({
        kind: command.kind === 'moveUnitGroup' ? 'moveUnit' : 'attackMoveUnit',
        ...destination,
        ...(command.queued ? { queued: true } : {}),
      });
      break;
    }
    case 'unitActionGroup':
      enqueue({ ...command.action, entity });
      break;
    case 'attackUnitGroup':
      enqueue({ kind: 'attackUnit', entity, target: command.target });
      break;
    case 'setStanceGroup':
      enqueue({ kind: 'setStance', entity, mode: command.mode });
      break;
    case 'setRegenerationGroup':
      enqueue({ kind: 'setRegeneration', entity, enabled: command.enabled });
      break;
  }
  return true;
}

/** Collect one explicit gesture before submitting it; never batch unrelated asynchronous input. */
export function enqueueUnitSelection(
  commands: readonly UnitSelectionCommand[],
  enqueue: (command: PlayerCommand) => void,
  onLimit?: () => void,
): boolean {
  const members: Array<{ entity: GroupActions['entity']; actions: UnitSelectionAction[] }> = [];
  const seen = new Set<GroupActions['entity']>();
  for (const command of commands) {
    const { entity, ...action } = command;
    const previous = members.at(-1);
    if (previous?.entity === entity) {
      if (previous.actions.length === MAX_UNIT_MEMBER_ACTIONS) {
        onLimit?.();
        return false;
      }
      previous.actions.push(action);
    } else {
      // Regrouping a noncontiguous member would move its later action ahead of another member's.
      if (seen.has(entity) || members.length === MAX_UNIT_ORDER_MEMBERS) {
        onLimit?.();
        return false;
      }
      seen.add(entity);
      members.push({ entity, actions: [action] });
    }
  }
  const first = members[0]?.actions[0];
  if (first === undefined) return false;
  const key = JSON.stringify(first);
  const shared = members.every(
    (member) => member.actions.length === 1 && JSON.stringify(member.actions[0]) === key,
  );
  return enqueueArmyOrder(
    shared
      ? {
          kind: 'unitActionGroup',
          members: members.map(({ entity }) => ({ entity })),
          action: first,
        }
      : { kind: 'unitOrdersGroup', members },
    enqueue,
    onLimit,
  );
}
