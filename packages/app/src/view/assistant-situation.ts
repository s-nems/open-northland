import { components, entitiesWith, type WorldSnapshot } from '@open-northland/sim';
import { isFinishedBuilding, ownerPlayerOf } from '../game/snapshot.js';
import { ownedBuildingsOfType } from '../hud/details-panel/model/building.js';
import {
  type AssistantBookings,
  type AssistantSituation,
  emptyBookings,
  NO_SITUATION,
} from '../hud/dom/assistant-window/model.js';

const RECRUIT_INTENTS: ReadonlySet<unknown> = new Set(components.ASSISTANT_RECRUIT_INTENTS);
const isRecruitIntent = (value: unknown): value is components.AssistantRecruitIntent =>
  RECRUIT_INTENTS.has(value);

/**
 * `seat`'s assistant orders in flight, off the booking markers the sim keeps on the wives and recruits
 * it sent. Both lists come from per-change component indexes and hold only the orders in flight.
 */
export function assistantBookingsOf(snapshot: WorldSnapshot, seat: number): AssistantBookings {
  const bookings = emptyBookings();
  for (const wife of entitiesWith(snapshot, 'AssistantChildOrder')) {
    if (ownerPlayerOf(wife) !== seat) continue;
    const order = wife.components.AssistantChildOrder as { sex?: unknown };
    if (order.sex === 'female') bookings.daughters += 1;
    else if (order.sex === 'male') bookings.sons += 1;
  }
  for (const recruit of entitiesWith(snapshot, 'AssistantRecruit')) {
    if (ownerPlayerOf(recruit) !== seat) continue;
    const booking = recruit.components.AssistantRecruit as { intent?: unknown; armed?: unknown };
    if (!isRecruitIntent(booking.intent)) continue;
    if (recruit.components.TrainingOrder !== undefined) bookings.drilling[booking.intent] += 1;
    else if (booking.armed === false && booking.intent !== 'trainSoldiers') {
      bookings.arming[booking.intent] += 1;
    }
  }
  return bookings;
}

/** Whether `seat` owns a finished barracks of any of `barracksTypes`; a site drills nobody yet. */
export function ownsBarracks(
  snapshot: WorldSnapshot,
  seat: number,
  barracksTypes: readonly number[],
): boolean {
  return barracksTypes.some((type) => ownedBuildingsOfType(snapshot, seat, type).some(isFinishedBuilding));
}

export function assistantSituationOf(
  snapshot: WorldSnapshot,
  seat: number | null,
  barracksTypes: readonly number[],
): AssistantSituation {
  if (seat === null) return NO_SITUATION;
  return {
    bookings: assistantBookingsOf(snapshot, seat),
    hasBarracks: ownsBarracks(snapshot, seat, barracksTypes),
  };
}
