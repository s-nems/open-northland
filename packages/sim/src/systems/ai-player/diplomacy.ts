import {
  AiPlayer,
  aiPlayerEntity,
  diplomacyStance,
  MAX_PLAYERS,
  setDiplomacyStance,
} from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import type { System } from '../context.js';
import { handlerTurn, scriptedSeatOnTurn } from './cadence.js';

/** The player slots the original's per-seat cursor walks, one per handler turn, whatever the map seats. */
const ORIGINAL_PLAYER_SLOTS = 20;

/** Whether the seat's strategic handler runs. Approximation: the original keeps its own enable byte,
 *  which `HAI_Disable` and a monster tribe clear; the corpus switches the handler off only whole, and
 *  that clears every module here. */
function strategicHandlerRuns(world: World, seat: number): boolean {
  const carrier = aiPlayerEntity(world, seat);
  return carrier !== null && Object.values(world.get(carrier, AiPlayer).modules).some(Boolean);
}

/**
 * A computer seat's answer to how another player stands toward it (reading of the the original's
 * `an original routine`, which ends the strategic handler's turn; that turn follows the
 * scripted handler's and is skipped while either handler is off). Each turn looks at one other slot:
 * a neutral seat turns enemy toward a player that holds it as enemy, and a friendly one lowers its
 * stance to the other's. An enemy seat never makes peace. The write goes past any lock, as the
 * original's setter does.
 *
 * Approximation: the original's cursor starts at slot 0 and moves once per turn the handler runs; it is
 * read here off the round index, which agrees while the seat's AI has run since the start. Not
 * modelled: a neutral seat also turns enemy toward a player whose people stood in its villages on six
 * looks in a row, and the handler skips its turns until it has laid out its villages
 * (`docs/tickets/sim/ai-diplomacy-trespass.md`).
 */
export const aiDiplomacySystem: System = (world, ctx) => {
  const seat = scriptedSeatOnTurn(world, ctx.tick);
  if (seat === null || !strategicHandlerRuns(world, seat)) return;
  const other = handlerTurn(ctx.tick) % ORIGINAL_PLAYER_SLOTS;
  if (other === seat || other >= MAX_PLAYERS) return;
  const ours = diplomacyStance(world, seat, other);
  const theirs = diplomacyStance(world, other, seat);
  if (ours === 'neutral' && theirs === 'enemy') setDiplomacyStance(world, seat, other, 'enemy');
  else if (ours === 'friend' && theirs !== 'friend') setDiplomacyStance(world, seat, other, theirs);
};
