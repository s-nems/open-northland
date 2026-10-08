import {
  MESSAGE_PRIORITY_LEVELS,
  type MessagePriorityLevel,
  USER_MESSAGE_TYPE,
  type UserMessageType,
  type UserMessageTypeName,
} from './types.js';

/** Original behavior: the base game and the CulturesNation mod give each message type the same one of
 *  three groups. `productionStalled` takes the group of the two per-worker notes it replaces, and
 *  `constructionStarved` the same one (owner ruling). */
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
];

const NOTABLE: readonly UserMessageTypeName[] = [
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
  'constructionStarved',
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
