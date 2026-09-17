import { describe, expect, it } from 'vitest';
import { JOB_BUILDER, JOB_COLLECTOR } from '../src/catalog/jobs.js';
import {
  cycleMessageLevel,
  DEFAULT_MESSAGE_LEVEL,
  messagePassesFilter,
  messagePriority,
} from '../src/hud/tool-panel/messages/priority.js';
import {
  type MessagePriorityLevel,
  USER_MESSAGE_TYPE,
  type UserMessageType,
  type UserMessageTypeName,
} from '../src/hud/tool-panel/messages/types.js';

const ALL_TYPES = Object.values(USER_MESSAGE_TYPE) as UserMessageType[];

function typesAt(level: MessagePriorityLevel, jobType: number | null): UserMessageType[] {
  return ALL_TYPES.filter((t) => messagePriority(t, jobType) === level);
}

describe('user message priority (byte evidence the original 0x4b29fc / the original 0x4b3419)', () => {
  it('covers every one of the 63 types with one of the three levels', () => {
    expect(ALL_TYPES).toHaveLength(63);
    expect(typesAt(2, null).length + typesAt(1, null).length + typesAt(0, null).length).toBe(63);
  });

  it('pins the important group', () => {
    const important: UserMessageTypeName[] = [
      'lostWithoutSignposts',
      'experienceUnlocks',
      'canProduceNewGood',
      'canDoNewJob',
      'canBuildNewHouse',
      'canBuildNewVehicle',
      'canEquipNewItem',
      'starving',
      'willDie',
      'humanAttacked',
      'houseAttacked',
      'vehicleNoPath',
      'vehicleAttacked',
      'humanDied',
      'playerSighted',
      'diplomacyChanged',
      'playerDied',
      'specialItemFound',
    ];
    expect(typesAt(2, null).sort((a, b) => a - b)).toEqual(
      important.map((n) => USER_MESSAGE_TYPE[n]).sort((a, b) => a - b),
    );
  });

  it('keeps the routine group routine, hunger included, while starving is important', () => {
    const routine: UserMessageTypeName[] = [
      'goodNotFound',
      'homeNotFound',
      'targetPersonNotFound',
      'nothingToDo',
      'waitingForGood',
      'stockFull',
      'cannotDamageTarget',
      'producedOneGood',
      'hungry',
      'tired',
      'bored',
      'gaveBirthToSon',
      'gaveBirthToDaughter',
      'wasBorn',
      'cannotMarry',
      'noOneToMarry',
      'noWayToMarry',
      'equipmentNotFound',
      'backpackFull',
    ];
    expect(typesAt(0, null).sort((a, b) => a - b)).toEqual(
      routine.map((n) => USER_MESSAGE_TYPE[n]).sort((a, b) => a - b),
    );
    expect(typesAt(1, null)).toHaveLength(26);
    expect(messagePriority(USER_MESSAGE_TYPE.hungry, JOB_BUILDER)).toBe(0);
    expect(messagePriority(USER_MESSAGE_TYPE.starving, JOB_BUILDER)).toBe(2);
  });

  it('raises a missing good to notable for a collector only', () => {
    expect(messagePriority(USER_MESSAGE_TYPE.goodNotFound, JOB_COLLECTOR)).toBe(1);
    expect(messagePriority(USER_MESSAGE_TYPE.goodNotFound, JOB_BUILDER)).toBe(0);
    expect(messagePriority(USER_MESSAGE_TYPE.goodNotFound, null)).toBe(0);
  });

  it('shows a message when its priority reaches the filter level', () => {
    expect(messagePassesFilter(0, 0)).toBe(true);
    expect(messagePassesFilter(0, 1)).toBe(false);
    expect(messagePassesFilter(1, 1)).toBe(true);
    expect(messagePassesFilter(1, 2)).toBe(false);
    expect(messagePassesFilter(2, 2)).toBe(true);
  });

  it('cycles the button through all three levels from the show-all default', () => {
    expect(DEFAULT_MESSAGE_LEVEL).toBe(0);
    expect(cycleMessageLevel(0)).toBe(1);
    expect(cycleMessageLevel(1)).toBe(2);
    expect(cycleMessageLevel(2)).toBe(0);
  });
});
