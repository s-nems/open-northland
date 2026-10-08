import { describe, expect, it } from 'vitest';
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

/** The original's types and the attack notes; this game's own `familyBlocked`, `productionStalled`,
 *  `constructionStarved` and `explorationFinished` are pinned on their own. */
const OWN_TYPES: readonly UserMessageType[] = [
  USER_MESSAGE_TYPE.familyBlocked,
  USER_MESSAGE_TYPE.productionStalled,
  USER_MESSAGE_TYPE.constructionStarved,
  USER_MESSAGE_TYPE.explorationFinished,
];
const ALL_TYPES = (Object.values(USER_MESSAGE_TYPE) as UserMessageType[]).filter(
  (type) => !OWN_TYPES.includes(type),
);

function typesAt(level: MessagePriorityLevel): UserMessageType[] {
  return ALL_TYPES.filter((t) => messagePriority(t) === level);
}

describe('user message priority (original behavior)', () => {
  it('covers every one of the 35 types with one of the three levels', () => {
    expect(ALL_TYPES).toHaveLength(35);
    expect(typesAt(2).length + typesAt(1).length + typesAt(0).length).toBe(35);
  });

  it('pins the important group', () => {
    const important: UserMessageTypeName[] = [
      'lostWithoutSignposts',
      'experienceUnlocks',
      'canProduceNewGood',
      'canDoNewJob',
      'starving',
      'willDie',
      'settlementAttacked',
      'vehicleNoPath',
      'humanDied',
      'playerSighted',
      'diplomacyChanged',
      'playerDied',
      'specialItemFound',
    ];
    expect(typesAt(2).sort((a, b) => a - b)).toEqual(
      important.map((n) => USER_MESSAGE_TYPE[n]).sort((a, b) => a - b),
    );
  });

  it('keeps the routine group routine, hunger included, while starving is important', () => {
    const routine: UserMessageTypeName[] = ['nothingToDo', 'hungry', 'tired', 'noOneToMarry'];
    expect(typesAt(0).sort((a, b) => a - b)).toEqual(
      routine.map((n) => USER_MESSAGE_TYPE[n]).sort((a, b) => a - b),
    );
    expect(typesAt(1)).toHaveLength(18);
    expect(messagePriority(USER_MESSAGE_TYPE.peopleAttacked)).toBe(1);
    expect(messagePriority(USER_MESSAGE_TYPE.hungry)).toBe(0);
    expect(messagePriority(USER_MESSAGE_TYPE.starving)).toBe(2);
  });

  it('ranks a held child order, a stalled workshop and an explored landmass notable, a starved site important', () => {
    expect(messagePriority(USER_MESSAGE_TYPE.familyBlocked)).toBe(1);
    expect(messagePriority(USER_MESSAGE_TYPE.productionStalled)).toBe(1);
    expect(messagePriority(USER_MESSAGE_TYPE.explorationFinished)).toBe(1);
    expect(messagePriority(USER_MESSAGE_TYPE.constructionStarved)).toBe(2);
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
