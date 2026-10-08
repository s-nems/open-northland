import type { OrderAnswer } from '@open-northland/audio';
import { type Command, orderedSettlers } from '@open-northland/sim';

/** The voices that answer a command the player just gave, or null for one that addresses no unit. */
export function orderAnswerOf(command: Command): OrderAnswer | null {
  const members = orderedSettlers(command);
  return members.length === 0 ? null : { members };
}
