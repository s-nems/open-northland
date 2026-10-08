import type { OrderAnswer } from '@open-northland/audio';
import { type Command, orderedSettlers } from '@open-northland/sim';

/** The orders a large group answers with the charge horn as well as its voices. */
const ATTACK_ORDERS: ReadonlySet<Command['kind']> = new Set([
  'attackUnit',
  'attackUnitGroup',
  'attackMoveUnit',
  'attackMoveUnitGroup',
]);

/** The voices that answer a command the player just gave, or null for one that addresses no unit. */
export function orderAnswerOf(command: Command): OrderAnswer | null {
  const members = orderedSettlers(command);
  if (members.length === 0) return null;
  return ATTACK_ORDERS.has(command.kind) ? { members, attack: true } : { members };
}
