import {
  aiSeatsOf,
  type GameSession,
  humanSeatsOf,
  isReadOnlySpectator,
  isSpectator,
  localPlayerOf,
} from '@open-northland/lockstep';
import { matchParticipants } from './match-participants.js';

/** The seat lists world assembly enqueues setup for, decided from the descriptor alone. */
export interface SessionRoles {
  readonly aiSeats: readonly number[];
  /** Seats whose chest-window assistant grants start on. */
  readonly assistantSeats: readonly number[];
  readonly matchParticipants: readonly number[];
}

/**
 * Every seat a person plays, on this client or another, gets its grants and its place in the match,
 * so two clients of one session enqueue the same setup. A read-only spectator drives no seat and
 * takes no grants; the overseer's grants still start on for the seat its chest window edits; a
 * spectator of either kind plays no seat in the match.
 */
export function sessionRoles(session: GameSession, neverDies: readonly number[]): SessionRoles {
  const aiSeats = aiSeatsOf(session);
  const humans = humanSeatsOf(session);
  const controlled = isReadOnlySpectator(session)
    ? []
    : isSpectator(session)
      ? [localPlayerOf(session)]
      : humans;
  return {
    aiSeats,
    assistantSeats: [...controlled, ...aiSeats],
    matchParticipants: matchParticipants({
      controlled: isSpectator(session) ? [] : humans,
      aiSeats,
      neverDies,
    }),
  };
}
