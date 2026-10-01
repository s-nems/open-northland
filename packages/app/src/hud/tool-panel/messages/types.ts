import type { DiplomacyState, HalfCellNode } from '@open-northland/sim';
import type { ChildOrderWait } from '../../../game/snapshot.js';
import type { MessageText } from './text.js';

/**
 * The notice types the column raises. The numbers follow the original's message ids where a type has a
 * counterpart there; they only key the feed, nothing persists them.
 *
 * The original never raises `cannotAttachVehicle`, which here stands in for the silently refused load of
 * a vehicle into a ship (approximation). The types past the original's range are this game's own: the
 * original fails a child order it cannot start without a word, reports every attacked body alone where
 * the two attack notes report one fight area each, and has a worker report each product it failed to
 * make where `productionStalled` reports the workshop once, with the reason.
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
  houseFinished: 0x2f,
  houseUpgraded: 0x30,
  vehicleNoPath: 0x32,
  vehicleNoCommander: 0x33,
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
  settlementAttacked: 0x81,
  peopleAttacked: 0x82,
  productionStalled: 0x83,
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

/** Why a workshop stands still, as its note names it: an input nothing of the seat holds or makes
 *  (`noInputSource`) or gathers (`noGatherer`), or only out of signpost reach; a product no store takes,
 *  or only stores out of reach; products set the seat cannot make yet; or a gate the diagnosis cannot
 *  name. */
export type ProductionStallReason =
  | 'noInputSource'
  | 'noGatherer'
  | 'inputOutOfReach'
  | 'noOutputStore'
  | 'outputOutOfReach'
  | 'productsLocked'
  | 'unknown';

/** A stalled workshop's reason and the good it names, if any. */
export interface ProductionStall {
  readonly reason: ProductionStallReason;
  readonly goodType: number | null;
}

/** Why a worker idle at a finished workplace stands, as its note names it, read off the sim's diagnosis
 *  of the worker: a load with no store to take it, every product stopped, nothing to gather in reach or
 *  no way to it, or nothing to collect at a porter's flag. A craft operator's gates are the stall note's
 *  to name. */
export type IdleReasonKind =
  | 'noStorage'
  | 'outputOutOfReach'
  | 'nothingSelected'
  | 'noResourceInArea'
  | 'noResource'
  | 'resourceRouteBlocked'
  | 'nothingAtFlag'
  | 'nothingToCarry'
  | 'noGame'
  | 'gameOutOfReach';

/** An idle worker's reason and the goods it names, possibly none. */
export interface IdleReason {
  readonly kind: IdleReasonKind;
  readonly goodTypes: readonly number[];
}

/** What one fight area has hit so far: distinct bodies of the seat's per kind, and who struck them. */
export interface FightTally {
  readonly buildings: number;
  readonly walls: number;
  readonly settlers: number;
  readonly vehicles: number;
  /** The seats whose blows landed, the first striker first. */
  readonly seats: readonly number[];
  /** Whether an unowned creature (a wild animal or a monster) struck too. */
  readonly wild: boolean;
  readonly lastHitTick: number;
}

/** What a source raises: the identity the feed dedupes on, before any text is composed for it. */
export interface PendingMessage {
  readonly type: UserMessageType;
  readonly subject: MessageSubject | null;
  /** Where the note's Select jumps when there is no subject to centre on: a death's spot, a fight's
   *  latest hit. */
  readonly at: HalfCellNode | null;
  /** Who a message with no live subject is about: the reaped settler's id, the seat number for a
   *  player-scoped note, or a fight area's id. Part of the identity, so two deaths inside one lifetime
   *  stay two notes. */
  readonly about: number | null;
  readonly goodType: number | null;
  /** Newly available capabilities carried together by the original's experience-unlock record. */
  readonly technologies: readonly MessageTechnology[] | null;
  /** The building type an unlock note pictures in place of its settler; absent when it opens none. */
  readonly building?: number;
  /** The subject settler's trade when the message was raised, or the trade a course taught; part of the
   *  identity. */
  readonly jobType: number | null;
  /** A family note's reason, part of its identity: a new reason retires the old note and raises its own. */
  readonly familyWait?: ChildOrderWait;
  /** A stall note's reason and good. The reason is part of the identity, as `familyWait` is: a new one
   *  raises its own note and retires the old one, dismissed or not; a new good only rewords the note. */
  readonly stall?: ProductionStall;
  /** An idle note's reason, null while the sim names none; not part of the identity, a new one rewords
   *  the standing note. */
  readonly idle?: IdleReason | null;
  /** A stance note's new stance, part of the identity: a later stance replaces the seat's earlier note. */
  readonly stance?: DiplomacyState;
  /** An attack note's area so far; not part of the identity, since every new hit updates it. */
  readonly fight?: FightTally;
}

export interface UserMessage extends PendingMessage {
  readonly id: number;
  readonly priority: MessagePriorityLevel;
  /** The sim tick the feed accepted it on; an event note's lifetime counts from here. */
  readonly tick: number;
  readonly text: MessageText;
}
