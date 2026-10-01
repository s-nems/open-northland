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
  workplaceNotFound: 'state',
  vehicleSiteNotFound: 'event',
  vehicleSiteOccupied: 'event',
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
