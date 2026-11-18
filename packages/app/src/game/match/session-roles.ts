import {
  type ComputerDifficulty,
  type GameSession,
  humanSeatsOf,
  machineSeatsOf,
} from '@open-northland/lockstep';
import { matchParticipants } from './participants.js';

/** The seat lists world assembly enqueues setup for, decided from the descriptor alone. */
export interface SessionRoles {
  readonly machineSeats: readonly number[];
  /** Seats that get the assistant's starting switches. */
  readonly assistantSeats: readonly number[];
  readonly matchParticipants: readonly number[];
}

/** Human and AI seats build the same world for players and observers. */
export function sessionRoles(session: GameSession, neverDies: readonly number[]): SessionRoles {
  const machineSeats = machineSeatsOf(session);
  const humans = humanSeatsOf(session);
  return {
    machineSeats,
    assistantSeats: [...humans, ...machineSeats],
    matchParticipants: matchParticipants({
      controlled: humans,
      machineSeats,
      neverDies,
    }),
  };
}

/** Each computer seat's lobby level. The session names a level only for a seat the computer plays,
 *  never for a person's seat or a map's scripted village. */
export function computerLevelsOf(
  session: Pick<GameSession, 'seats'>,
): ReadonlyMap<number, ComputerDifficulty> {
  return new Map(
    session.seats.flatMap((seat) => (seat.difficulty === undefined ? [] : [[seat.player, seat.difficulty]])),
  );
}
