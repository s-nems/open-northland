import { JOB_COLLECTOR } from '../../../catalog/jobs.js';
import { GUI_FRAME } from '../../../content/gui-atlas-map.js';
import {
  MESSAGE_PRIORITY_LEVELS,
  type MessagePriorityLevel,
  USER_MESSAGE_TYPE,
  type UserMessageType,
  type UserMessageTypeName,
} from './types.js';

/**
 * Byte evidence: the per-type priority switch of the owned `the original` (VA 0x4b29fc) and the owned
 * CulturesNation `the original` (VA 0x4b3419) select the same three groups; `goodNotFound` alone branches on
 * the settler's trade.
 */
const IMPORTANT: readonly UserMessageTypeName[] = [
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

const NOTABLE: readonly UserMessageTypeName[] = [
  'taskCompleted',
  'taskFailed',
  'buildMaterialNotFound',
  'workplaceNotFound',
  'vehicleSiteNotFound',
  'vehicleSiteOccupied',
  'noCoinsForTraining',
  'noVehicleForWork',
  'noTradeAgreement',
  'producedAllGoods',
  'couldNotProduceOneGood',
  'couldNotProduceAnyGoods',
  'wantsToPray',
  'grewUp',
  'cannotAttachHouse',
  'cannotDetachHouse',
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
];

const IMPORTANT_LEVEL: MessagePriorityLevel = 2;
const NOTABLE_LEVEL: MessagePriorityLevel = 1;
const ROUTINE_LEVEL: MessagePriorityLevel = 0;

const FIXED_PRIORITY: ReadonlyMap<UserMessageType, MessagePriorityLevel> = new Map([
  ...IMPORTANT.map((name) => [USER_MESSAGE_TYPE[name], IMPORTANT_LEVEL] as const),
  ...NOTABLE.map((name) => [USER_MESSAGE_TYPE[name], NOTABLE_LEVEL] as const),
]);

/** A message's priority: fixed per type, except that a collector's missing good is notable. */
export function messagePriority(type: UserMessageType, jobType: number | null): MessagePriorityLevel {
  if (type === USER_MESSAGE_TYPE.goodNotFound) {
    return jobType === JOB_COLLECTOR ? NOTABLE_LEVEL : ROUTINE_LEVEL;
  }
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

export interface MessageLevelFace {
  /** The envelope glyph: three seals at level 0, two at 1, one at 2. */
  readonly gfx: number;
  /** The button's tooltip in the ingamegui `main` table. */
  readonly tooltipStringId: number;
}

export const MESSAGE_LEVEL_FACE: Readonly<Record<MessagePriorityLevel, MessageLevelFace>> = {
  0: { gfx: GUI_FRAME.message_priority_button, tooltipStringId: 14 },
  1: { gfx: GUI_FRAME.message_priority_button_important, tooltipStringId: 15 },
  2: { gfx: GUI_FRAME.message_priority_button_only_important, tooltipStringId: 16 },
};
