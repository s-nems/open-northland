import { components, entitiesWith, type WorldSnapshot } from '@open-northland/sim';
import { ownerPlayerOf } from '../game/snapshot.js';
import { type AssistantBookings, NO_BOOKINGS, perIntent } from '../hud/dom/assistant-window/model.js';

const RECRUIT_INTENTS: ReadonlySet<unknown> = new Set(components.ASSISTANT_RECRUIT_INTENTS);
const isRecruitIntent = (value: unknown): value is components.AssistantRecruitIntent =>
  RECRUIT_INTENTS.has(value);

/**
 * `seat`'s assistant orders in flight, off the booking markers the sim keeps on the wives and recruits
 * it sent. Both lists come from per-change component indexes and hold only the orders in flight.
 */
export function assistantBookingsOf(snapshot: WorldSnapshot, seat: number): AssistantBookings {
  let daughters = 0;
  let sons = 0;
  const drilling = perIntent();
  const arming = perIntent();
  for (const wife of entitiesWith(snapshot, 'AssistantChildOrder')) {
    if (ownerPlayerOf(wife) !== seat) continue;
    const order = wife.components.AssistantChildOrder as { sex?: unknown };
    if (order.sex === 'female') daughters += 1;
    else if (order.sex === 'male') sons += 1;
  }
  for (const recruit of entitiesWith(snapshot, 'AssistantRecruit')) {
    if (ownerPlayerOf(recruit) !== seat) continue;
    const booking = recruit.components.AssistantRecruit as { intent?: unknown; armed?: unknown };
    if (!isRecruitIntent(booking.intent)) continue;
    if (recruit.components.TrainingOrder !== undefined) drilling[booking.intent] += 1;
    else if (booking.armed === false && booking.intent !== 'trainSoldiers') {
      arming[booking.intent] += 1;
    }
  }
  return { daughters, sons, drilling, arming };
}

/** No seat (the whole map) has no assistant, so nothing is booked. */
export const seatBookingsOf = (snapshot: WorldSnapshot, seat: number | null): AssistantBookings =>
  seat === null ? NO_BOOKINGS : assistantBookingsOf(snapshot, seat);
