import { AiPlayer } from '../../components/ai-player.js';
import type { World } from '../../ecs/world.js';

/**
 * Ticks between one seat's decision passes - 2 s at the 12 ticks/s base clock. Approximation: a
 * genre-convention seconds-scale strategy cadence, not an original value.
 */
export const AI_DECISION_INTERVAL_TICKS = 24;

/** How far apart consecutive seats' decision slots lie, in ticks (authored). Coprime with the interval,
 *  so every seat below 24 gets a slot of its own, and seats 0-6 land at least three ticks apart. */
const AI_SEAT_SLOT_STEP_TICKS = 7;

/** Whether `tick` is one of `player`'s strategic decisions. */
export function aiDecisionDue(tick: number, player: number): boolean {
  return (
    tick % AI_DECISION_INTERVAL_TICKS === (player * AI_SEAT_SLOT_STEP_TICKS) % AI_DECISION_INTERVAL_TICKS
  );
}

/**
 * The scripted handlers' round-robin. Original behavior: each seat's handler gets one
 * turn per 60 ticks, seat `p` on tick `3p` of the round, with the round's index as its turn number.
 */
export const AI_HANDLER_ROUND_TICKS = 60;
const AI_SEAT_TURN_TICKS = 3;

/** The computer seat whose scripted handler takes its turn on `tick`, or null on a tick that is no
 *  seat's or belongs to a seat the map `AI_Disable`d. */
export function scriptedSeatOnTurn(world: World, tick: number): number | null {
  const offset = tick % AI_HANDLER_ROUND_TICKS;
  if (offset % AI_SEAT_TURN_TICKS !== 0) return null;
  const player = offset / AI_SEAT_TURN_TICKS;
  for (const e of world.query(AiPlayer)) {
    const seat = world.get(e, AiPlayer);
    if (seat.player === player) return seat.scripted ? player : null;
  }
  return null;
}

/** The turn number the handler on `tick` is given: how many whole rounds have passed. */
export function handlerTurn(tick: number): number {
  return Math.floor(tick / AI_HANDLER_ROUND_TICKS);
}
