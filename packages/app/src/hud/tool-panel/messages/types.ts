import type { HalfCellNode } from '@open-northland/sim';
import type { ChildOrderWait } from '../../../game/snapshot.js';
import type { MessageText } from './text.js';

/**
 * The notice types the column raises. The numbers follow the original's message ids where a type has a
 * counterpart there; they only key the feed, nothing persists them.
 *
 * The original never raises `cannotAttachVehicle`, which here stands in for the silently refused load of
 * a vehicle into a ship (approximation). `familyBlocked` is this game's own, past the original's range:
 * the original fails a child order it cannot start without a word.
 */
export const USER_MESSAGE_TYPE = {
  lostWithoutSignposts: 0x03,
  workplaceNotFound: 0x08,
  vehicleSiteNotFound: 0x09,
  vehicleSiteOccupied: 0x0a,
  nothingToDo: 0x0b,
  noVehicleForWork: 0x0f,
  experienceUnlocks: 0x12,
  canProduceNewGood: 0x13,
  canDoNewJob: 0x14,
  hungry: 0x1c,
  tired: 0x1d,
  wantsToPray: 0x1f,
  starving: 0x20,
  willDie: 0x21,
  grewUp: 0x25,
  noOneToMarry: 0x27,
  cannotEnterVehicle: 0x2b,
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
  familyBlocked: 0x80,
} as const;

export type UserMessageTypeName = keyof typeof USER_MESSAGE_TYPE;
export type UserMessageType = (typeof USER_MESSAGE_TYPE)[UserMessageTypeName];

/** The original's message priority levels: 0 routine, 1 notable, 2 important. */
export type MessagePriorityLevel = 0 | 1 | 2;

export const MESSAGE_PRIORITY_LEVELS: readonly MessagePriorityLevel[] = [0, 1, 2];

/** What a message is about; the text names the subject and its liveness bounds the message. */
export type MessageSubject =
  | { readonly kind: 'settler'; readonly entity: number }
  | { readonly kind: 'building'; readonly entity: number }
  | { readonly kind: 'vehicle'; readonly entity: number };

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
  /** The subject settler's trade when the message was raised, or the trade a course taught; part of the
   *  identity. */
  readonly jobType: number | null;
  /** A family note's reason, part of its identity: a new reason retires the old note and raises its own. */
  readonly familyWait?: ChildOrderWait;
}

export interface UserMessage extends PendingMessage {
  readonly id: number;
  readonly priority: MessagePriorityLevel;
  /** The sim tick the feed accepted it on; lifetime and history expiry count from here. */
  readonly tick: number;
  readonly text: MessageText;
}
