import {
  atPeace,
  computerControllerRuns,
  diplomacyStance,
  isMatchParticipant,
  isScriptedEconomySeat,
  MAX_PLAYERS,
  setDiplomacyStance,
} from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import { handlerTurn, machineSeatOnTurn } from '../ai-shared/cadence.js';
import type { System } from '../context.js';
import { seatArchetype } from './build-order/order/seat-order.js';

/** The player slots the original's per-seat cursor walks, one per handler turn, whatever the map seats. */
const ORIGINAL_PLAYER_SLOTS = 20;

/**
 * A computer seat's answer to how another player stands toward it (the original's diplomacy
 * step). Computer permission gates this independently of map tasks. Each turn looks at one
 * other slot: a neutral seat turns enemy toward a player
 * that holds it as enemy, and a friendly one lowers its stance to the other's. An enemy seat never makes
 * peace. The write goes past any lock, as the original's setter does. A lobby peace freezes the stances
 * between its members until it ends.
 *
 * Owner ruling: a seat playing the islands archetype also declares on every match player it holds
 * as neutral, since island seats that wait to be declared on never fight. Friends stay friends.
 *
 * Approximation: the original's cursor starts at slot 0 and moves once per turn the handler runs; it is
 * read here off the round index, which agrees while the seat's AI has run since the start. Not
 * modelled: a neutral seat also turns enemy toward a player whose people stood in its villages on six
 * looks in a row, and the handler skips its turns until it has laid out its villages
 * (`docs/tickets/sim/ai-diplomacy-trespass.md`).
 */
export const computerDiplomacySystem: System = (world, ctx) => {
  const seat = machineSeatOnTurn(world, ctx.tick);
  if (seat === null || !computerControllerRuns(world, seat)) return;
  const other = handlerTurn(ctx.tick) % ORIGINAL_PLAYER_SLOTS;
  if (other === seat || other >= MAX_PLAYERS || atPeace(world, seat, other)) return;
  const ours = diplomacyStance(world, seat, other);
  const theirs = diplomacyStance(world, other, seat);
  if (ours === 'neutral' && (theirs === 'enemy' || declaresOn(world, seat, other)))
    setDiplomacyStance(world, seat, other, 'enemy');
  else if (ours === 'friend' && theirs !== 'friend') setDiplomacyStance(world, seat, other, theirs);
};

/** Whether `seat` declares war on `other` unprompted: an islands seat against a match player whose
 *  economy runs like a player's, never a map-scripted camp or a slot outside the match. */
function declaresOn(world: World, seat: number, other: number): boolean {
  return (
    seatArchetype(world, seat) === 'islands' &&
    isMatchParticipant(world, other) &&
    !isScriptedEconomySeat(world, other)
  );
}
