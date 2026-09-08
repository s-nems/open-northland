import type { DiplomacyState } from '@open-northland/sim';
import type { MessageNaming, RaisedMessage } from './raise.js';
import { USER_MESSAGE_TYPE, type UserMessageType } from './types.js';

/** One seat the local player has met, as the diplomacy roster lists it. */
export interface MetSeat {
  readonly player: number;
  /** The seat's stance toward this player, which both of these rows report. */
  readonly towardYou: DiplomacyState;
}

export interface DiplomacyMessageSource {
  /** The notes owed for what the roster learned since the last poll. */
  poll(naming: MessageNaming): readonly RaisedMessage[];
}

const NO_MESSAGES: readonly RaisedMessage[] = [];

function seatNote(naming: MessageNaming, type: UserMessageType, seat: MetSeat): RaisedMessage {
  return {
    pending: { type, subject: null, at: null, about: seat.player, goodType: null, jobType: null },
    compose: () =>
      naming.text(type, {
        subjectName: naming.player(seat.player),
        jobLabel: null,
        goodName: null,
        stanceName: naming.stance(seat.towardYou),
      }),
  };
}

/**
 * The local player's messages about the other seats: a first contact, and a seat that changed how it
 * stands toward this one. Read off the diplomacy roster rather than the world snapshot, since discovery
 * and stance are player-level state no entity carries.
 *
 * The first poll only records. A resumed game, and any game with fog off where every seat reads as met
 * from the first tick, must not announce contacts the player already has.
 */
export function createDiplomacyMessageSource(metSeats: () => readonly MetSeat[]): DiplomacyMessageSource {
  let known: Map<number, DiplomacyState> | null = null;
  return {
    poll: (naming) => {
      const seats = metSeats();
      const before = known;
      known = new Map(seats.map((seat) => [seat.player, seat.towardYou]));
      if (before === null) return NO_MESSAGES;
      const out: RaisedMessage[] = [];
      for (const seat of seats) {
        const was = before.get(seat.player);
        if (was === undefined) out.push(seatNote(naming, USER_MESSAGE_TYPE.playerSighted, seat));
        else if (was !== seat.towardYou) {
          out.push(seatNote(naming, USER_MESSAGE_TYPE.diplomacyChanged, seat));
        }
      }
      return out;
    },
  };
}
