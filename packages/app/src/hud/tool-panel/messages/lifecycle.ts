import { USER_MESSAGE_TYPE, type UserMessageType, type UserMessageTypeName } from './types.js';

/**
 * How a notice lives. A `state` notice reports something the sweep or a retire rule can watch: it stands
 * while the state lasts and retires when it ends, and a dismissal holds until then. An `event` notice
 * reports a moment: it lives out the feed's lifetime, and a dismissal holds for a set time from the
 * dismissal. Departs from the original, which ages every message out alike.
 */
export type NoticeLifecycle = 'state' | 'event';

const LIFECYCLE: Readonly<Record<UserMessageTypeName, NoticeLifecycle>> = {
  lostWithoutSignposts: 'state',
  cannotFindGood: 'state',
  workplaceNotFound: 'state',
  // The workshop's refusal memo stands while the search keeps failing (`retire.ts`).
  vehicleSiteNotFound: 'state',
  vehicleSiteOccupied: 'state',
  nothingToDo: 'state',
  noVehicleForWork: 'state',
  experienceUnlocks: 'event',
  canProduceNewGood: 'event',
  canDoNewJob: 'event',
  hungry: 'state',
  tired: 'state',
  wantsToPray: 'state',
  starving: 'state',
  willDie: 'state',
  // Retires early once a grown man takes up a trade or a grown woman has a home (`retire.ts`).
  grewUp: 'event',
  // A refused order: marriage ends it early, but the snapshot cannot tell when a partner comes in reach.
  noOneToMarry: 'event',
  cannotEnterVehicle: 'event',
  houseFinished: 'event',
  houseUpgraded: 'event',
  // A refused drive: a later drive ends it early, but the snapshot cannot tell when a route opens.
  vehicleNoPath: 'event',
  vehicleNoCommander: 'state',
  vehicleNoAnimal: 'state',
  vehicleNoPassengerRoom: 'event',
  cannotAttachVehicle: 'event',
  vehicleCannotNearShip: 'event',
  cannotLeaveVehicle: 'event',
  vehicleNoCarrier: 'state',
  humanDied: 'event',
  playerSighted: 'event',
  diplomacyChanged: 'event',
  playerDied: 'event',
  specialItemFound: 'event',
  familyBlocked: 'state',
  // A fight stands while blows keep landing in its area (`fight-areas.ts`).
  settlementAttacked: 'state',
  peopleAttacked: 'state',
  productionStalled: 'state',
  constructionStarved: 'state',
  explorationFinished: 'event',
};

const LIFECYCLE_BY_TYPE: ReadonlyMap<UserMessageType, NoticeLifecycle> = new Map(
  (Object.entries(USER_MESSAGE_TYPE) as [UserMessageTypeName, UserMessageType][]).map(([name, type]) => [
    type,
    LIFECYCLE[name],
  ]),
);

export function lifecycleOf(type: UserMessageType): NoticeLifecycle {
  return LIFECYCLE_BY_TYPE.get(type) ?? 'event';
}

/** One settler's hunger stages, lightest first. The settler shows only its heaviest card: a heavier stage
 *  replaces the lighter one, and the lighter one shows again once the heavier stage passes. */
export const HUNGER_CHAIN: readonly UserMessageType[] = [
  USER_MESSAGE_TYPE.hungry,
  USER_MESSAGE_TYPE.starving,
  USER_MESSAGE_TYPE.willDie,
];

/** A type's place in {@link HUNGER_CHAIN}, or undefined for a type outside it. */
export function hungerStageOf(type: UserMessageType): number | undefined {
  const stage = HUNGER_CHAIN.indexOf(type);
  return stage < 0 ? undefined : stage;
}

/** The state notes the snapshot sweep raises again on every pass while their state lasts. One pushed off
 *  a full feed comes back once there is room, so a full feed gives these up first; any other note pushed
 *  off would be lost. */
const POLLED: ReadonlySet<UserMessageType> = new Set<UserMessageType>([
  USER_MESSAGE_TYPE.lostWithoutSignposts,
  USER_MESSAGE_TYPE.workplaceNotFound,
  USER_MESSAGE_TYPE.nothingToDo,
  USER_MESSAGE_TYPE.cannotFindGood,
  USER_MESSAGE_TYPE.noVehicleForWork,
  USER_MESSAGE_TYPE.hungry,
  USER_MESSAGE_TYPE.tired,
  USER_MESSAGE_TYPE.wantsToPray,
  USER_MESSAGE_TYPE.starving,
  USER_MESSAGE_TYPE.willDie,
  USER_MESSAGE_TYPE.familyBlocked,
  USER_MESSAGE_TYPE.productionStalled,
  USER_MESSAGE_TYPE.constructionStarved,
]);

export function isPolledNote(type: UserMessageType): boolean {
  return POLLED.has(type);
}

/** The notes of which only the latest reading about a subject matters: a seat's newest stance takes the
 *  earlier stance note's place, shown or dismissed. */
const LATEST_ONLY: ReadonlySet<UserMessageType> = new Set<UserMessageType>([
  USER_MESSAGE_TYPE.diplomacyChanged,
]);

export function keepsLatestOnly(type: UserMessageType): boolean {
  return LATEST_ONLY.has(type);
}
