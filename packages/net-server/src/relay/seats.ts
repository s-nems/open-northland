import type { SessionSeat } from '@open-northland/lockstep';
import type {
  DepartedSeatMode,
  RoomSeatSetup,
  RoomSeatView,
  VacantSeatMode,
} from '@open-northland/net-protocol';
import type { Member, Refusal } from './member.js';

interface Seat {
  readonly player: number;
  /** What the seat is while nobody sits in it. */
  vacantMode: VacantSeatMode;
  readonly offers: readonly VacantSeatMode[];
  color: number;
  team?: number | null;
  member: Member | null;
}

export interface SeatChange {
  readonly mode?: VacantSeatMode;
  readonly color?: number;
  readonly team?: number | null;
}

/** The room's seats: who sits where, and what a vacant seat does. */
export class SeatTable {
  private readonly seats: readonly Seat[];

  constructor(setups: readonly RoomSeatSetup[]) {
    this.seats = setups.map((seat) => ({
      player: seat.player,
      vacantMode: seat.mode,
      offers: seat.offers,
      color: seat.color,
      ...(seat.team === undefined ? {} : { team: seat.team }),
      member: null,
    }));
  }

  get count(): number {
    return this.seats.length;
  }

  /** What the seat becomes when its member departs: the room's fallout when the seat offers it, else
   *  its lobby setting, `idle` for an `absent` one whose settlers already stand. */
  departedModeOf(player: number, fallout: DepartedSeatMode | undefined): DepartedSeatMode | null {
    const seat = this.at(player);
    if (seat === null) return null;
    if (fallout !== undefined && seat.offers.includes(fallout)) return fallout;
    return seat.vacantMode === 'absent' ? 'idle' : seat.vacantMode;
  }

  /** A departure's handover, which stands whatever the lobby offered. */
  vacate(player: number, mode: DepartedSeatMode): void {
    const seat = this.at(player);
    if (seat !== null) seat.vacantMode = mode;
  }

  claim(member: Member, player: number): Refusal {
    const seat = this.at(player);
    if (seat === null) return `no seat ${player}`;
    if (seat.member !== null && seat.member !== member)
      return `seat ${player} is taken by ${seat.member.nick}`;
    this.standUp(member);
    seat.member = member;
    member.seat = player;
    return null;
  }

  standUp(member: Member): void {
    if (member.seat === null) return;
    const seat = this.at(member.seat);
    if (seat !== null) seat.member = null;
    member.seat = null;
    member.ready = false;
  }

  /** Change a seat's lobby setting; the mode of a taken seat is its occupant's, not the creator's. */
  setUp(player: number, change: SeatChange): Refusal {
    const seat = this.at(player);
    if (seat === null) return `no seat ${player}`;
    if (change.mode !== undefined) {
      if (seat.member !== null) return `seat ${player} is taken by ${seat.member.nick}`;
      if (!seat.offers.includes(change.mode)) return `seat ${player} does not offer ${change.mode}`;
      seat.vacantMode = change.mode;
    }
    if (change.color !== undefined) seat.color = change.color;
    if (change.team !== undefined && change.team !== (seat.team ?? null)) seat.team = change.team;
    return null;
  }

  /** The roster as a session descriptor carries it: every claimed seat `human`. */
  sessionSeats(): readonly SessionSeat[] {
    return this.seats.map((seat) => this.sessionSeat(seat));
  }

  views(): readonly RoomSeatView[] {
    return this.seats.map((seat) => ({
      ...this.sessionSeat(seat),
      offers: seat.offers,
      nick: seat.member?.nick ?? null,
      ready: seat.member?.ready ?? false,
    }));
  }

  private at(player: number): Seat | null {
    return this.seats.find((seat) => seat.player === player) ?? null;
  }

  private sessionSeat(seat: Seat): SessionSeat {
    return {
      player: seat.player,
      mode: seat.member === null ? seat.vacantMode : 'human',
      color: seat.color,
      ...(seat.team === undefined ? {} : { team: seat.team }),
    };
  }
}
