import {
  MESSAGE_PRIORITY_LEVELS,
  type MessagePriorityLevel,
  USER_MESSAGE_TYPE,
  type UserMessageType,
  type UserMessageTypeName,
} from './types.js';

/** Original behavior: the base game and the CulturesNation mod give each message type the same one of
 *  three groups. `productionStalled` takes the group of the two per-worker notes it replaces;
 *  `constructionStarved` is important, since nothing else tells of a site that will never finish (owner
 *  ruling). The original ranks `cannotFindGood` notable for a collector alone; here every trade's note is. */
const IMPORTANT: readonly UserMessageTypeName[] = [
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
  'constructionStarved',
];

const NOTABLE: readonly UserMessageTypeName[] = [
  'cannotFindGood',
  'workplaceNotFound',
  'vehicleSiteNotFound',
  'vehicleSiteOccupied',
  'noVehicleForWork',
  'wantsToPray',
  'grewUp',
  'cannotEnterVehicle',
  'houseFinished',
  'houseUpgraded',
  'vehicleNoCommander',
  'vehicleNoAnimal',
  'vehicleNoPassengerRoom',
  'cannotAttachVehicle',
  'vehicleCannotNearShip',
  'cannotLeaveVehicle',
  'vehicleNoCarrier',
  'familyBlocked',
  'peopleAttacked',
  'productionStalled',
];

const IMPORTANT_LEVEL: MessagePriorityLevel = 2;
const NOTABLE_LEVEL: MessagePriorityLevel = 1;
const ROUTINE_LEVEL: MessagePriorityLevel = 0;

const FIXED_PRIORITY: ReadonlyMap<UserMessageType, MessagePriorityLevel> = new Map([
  ...IMPORTANT.map((name) => [USER_MESSAGE_TYPE[name], IMPORTANT_LEVEL] as const),
  ...NOTABLE.map((name) => [USER_MESSAGE_TYPE[name], NOTABLE_LEVEL] as const),
]);

/** A message's priority, fixed per type. */
export function messagePriority(type: UserMessageType): MessagePriorityLevel {
  return FIXED_PRIORITY.get(type) ?? ROUTINE_LEVEL;
}

/** The strip shows a message only when its priority reaches the player's filter level. */
export function messagePassesFilter(priority: MessagePriorityLevel, level: MessagePriorityLevel): boolean {
  return priority >= level;
}

/** A new game shows everything. */
export const DEFAULT_MESSAGE_LEVEL: MessagePriorityLevel = 0;

/** The button click steps through the levels and wraps. */
export function cycleMessageLevel(level: MessagePriorityLevel): MessagePriorityLevel {
  const i = MESSAGE_PRIORITY_LEVELS.indexOf(level);
  const next = MESSAGE_PRIORITY_LEVELS[(i + 1) % MESSAGE_PRIORITY_LEVELS.length];
  if (next === undefined) throw new Error('message-priority: level cycle index out of range');
  return next;
}
