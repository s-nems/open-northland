import type { HalfCellNode } from '@open-northland/sim';
import type { MessageText } from './text.js';

/**
 * The original's message ids (`ingameguimessages.cif` rows 15-134 spell out each one). The
 * id is the key of the original's priority table and of the string-id map, so it is pinned here.
 *
 * The original never raises seven of them: `taskCompleted`, `waitingForGood`, `bored`, `wasBorn`,
 * `cannotAttachVehicle`, and the two `gaveBirth` ids. Nothing here raises them either.
 */
export const USER_MESSAGE_TYPE = {
  taskCompleted: 0x01,
  taskFailed: 0x02,
  lostWithoutSignposts: 0x03,
  goodNotFound: 0x04,
  buildMaterialNotFound: 0x05,
  homeNotFound: 0x06,
  targetPersonNotFound: 0x07,
  workplaceNotFound: 0x08,
  vehicleSiteNotFound: 0x09,
  vehicleSiteOccupied: 0x0a,
  nothingToDo: 0x0b,
  waitingForGood: 0x0c,
  stockFull: 0x0d,
  noCoinsForTraining: 0x0e,
  noVehicleForWork: 0x0f,
  noTradeAgreement: 0x10,
  cannotDamageTarget: 0x11,
  experienceUnlocks: 0x12,
  canProduceNewGood: 0x13,
  canDoNewJob: 0x14,
  canBuildNewHouse: 0x15,
  canBuildNewVehicle: 0x16,
  canEquipNewItem: 0x17,
  producedOneGood: 0x18,
  producedAllGoods: 0x19,
  couldNotProduceOneGood: 0x1a,
  couldNotProduceAnyGoods: 0x1b,
  hungry: 0x1c,
  tired: 0x1d,
  bored: 0x1e,
  wantsToPray: 0x1f,
  starving: 0x20,
  willDie: 0x21,
  gaveBirthToSon: 0x22,
  gaveBirthToDaughter: 0x23,
  wasBorn: 0x24,
  grewUp: 0x25,
  cannotMarry: 0x26,
  noOneToMarry: 0x27,
  noWayToMarry: 0x28,
  cannotAttachHouse: 0x29,
  cannotDetachHouse: 0x2a,
  cannotEnterVehicle: 0x2b,
  equipmentNotFound: 0x2c,
  backpackFull: 0x2d,
  humanAttacked: 0x2e,
  houseFinished: 0x2f,
  houseUpgraded: 0x30,
  houseAttacked: 0x31,
  vehicleNoPath: 0x32,
  vehicleNoCommander: 0x33,
  vehicleAttacked: 0x34,
  vehicleNoAnimal: 0x35,
  vehicleNoPassengerRoom: 0x36,
  cannotAttachVehicle: 0x37,
  vehicleCannotNearShip: 0x38,
  cannotLeaveVehicle: 0x39,
  vehicleNoCarrier: 0x3a,
  humanDied: 0x3b,
  playerSighted: 0x3c,
  diplomacyChanged: 0x3d,
  playerDied: 0x3e,
  specialItemFound: 0x3f,
} as const;

export type UserMessageTypeName = keyof typeof USER_MESSAGE_TYPE;
export type UserMessageType = (typeof USER_MESSAGE_TYPE)[UserMessageTypeName];

/** The original's message priority levels: 0 routine, 1 notable, 2 important. */
export type MessagePriorityLevel = 0 | 1 | 2;

export const MESSAGE_PRIORITY_LEVELS: readonly MessagePriorityLevel[] = [0, 1, 2];

/** What a message is about; the subject's name prefixes the text and its liveness bounds the message. */
export type MessageSubject =
  | { readonly kind: 'settler'; readonly entity: number }
  | { readonly kind: 'building'; readonly entity: number };

export interface MessageTechnology {
  readonly kind: 'job' | 'good' | 'house';
  readonly typeId: number;
}

/** What a source raises: the identity the feed dedupes on, before any text is composed for it. */
export interface PendingMessage {
  readonly type: UserMessageType;
  readonly subject: MessageSubject | null;
  /** Where the note's Select jumps when there is no subject left to centre on (a death). */
  readonly at: HalfCellNode | null;
  /** Who a message with no live subject is about: the reaped settler's id, or the seat number for a
   *  player-scoped note. Part of the identity, so two deaths inside one lifetime stay two notes. */
  readonly about: number | null;
  readonly goodType: number | null;
  /** Newly available capabilities carried together by the original's experience-unlock record. */
  readonly technologies: readonly MessageTechnology[] | null;
  /** The subject settler's trade when the message was raised; the priority rule for a missing good
   *  reads it. */
  readonly jobType: number | null;
}

export interface UserMessage extends PendingMessage {
  readonly id: number;
  readonly priority: MessagePriorityLevel;
  /** The sim tick the feed accepted it on; lifetime and history expiry count from here. */
  readonly tick: number;
  readonly text: MessageText;
}
