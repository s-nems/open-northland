import type { GameSession, SessionSeat } from '@open-northland/lockstep';
import {
  MAX_MEMBERS,
  MAX_NICK_LENGTH,
  PAUSE_BUDGET,
  type RoomSeatSetup,
  type RoomSeatView,
  type RoomSettings,
  type RoomState,
  type RoomSummary,
  type RoomView,
  type ServerMessage,
  type VacantSeatMode,
  type WireEnvelope,
} from '@open-northland/net-protocol';
import { RoomClock } from './room-clock.js';

export interface Member {
  readonly token: string;
  /** Unique within the room; a duplicate gets a numeric suffix. */
  readonly nick: string;
  connected: boolean;
  seat: number | null;
  ready: boolean;
  loaded: boolean;
  pausesUsed: number;
}

interface Seat {
  readonly player: number;
  /** What the seat is while nobody sits in it. */
  vacantMode: VacantSeatMode;
  color: number;
  member: Member | null;
}

export interface SeatChange {
  readonly mode?: VacantSeatMode;
  readonly color?: number;
}

/** Null when the action went through, otherwise why it was refused. */
export type Refusal = string | null;

export type Deliver = (member: Member, message: ServerMessage) => void;

/**
 * One room: its seats, the people in it, and once started its clock. Settings belong to the creator
 * until the start; after it there is no host, and any member may drive the clock.
 */
export class Room {
  readonly id: string;
  private readonly settings: RoomSettings;
  private readonly seats: readonly Seat[];
  private readonly members = new Map<string, Member>();
  /** Owns the settings and the start; passes to the next member when the creator leaves the lobby. */
  private creatorToken: string;
  private readonly deliver: Deliver;
  private clock: RoomClock | null = null;
  /** The roster as every client built its world; fixed at the start, whatever the seats do after. */
  private startedSeats: readonly SessionSeat[] | null = null;

  constructor(
    id: string,
    creator: Member,
    settings: RoomSettings,
    seats: readonly RoomSeatSetup[],
    deliver: Deliver,
  ) {
    this.id = id;
    this.settings = settings;
    this.seats = seats.map((seat) => ({
      player: seat.player,
      vacantMode: seat.mode,
      color: seat.color,
      member: null,
    }));
    this.creatorToken = creator.token;
    this.deliver = deliver;
    this.members.set(creator.token, creator);
  }

  get state(): RoomState {
    return this.clock === null ? 'lobby' : 'running';
  }

  get name(): string {
    return this.settings.name;
  }

  get connectedCount(): number {
    let count = 0;
    for (const member of this.members.values()) if (member.connected) count++;
    return count;
  }

  memberTokens(): readonly string[] {
    return [...this.members.keys()];
  }

  memberOf(token: string): Member | null {
    return this.members.get(token) ?? null;
  }

  /** A room-unique nick for someone joining as `nick`. */
  uniqueNick(nick: string): string {
    const taken = new Set([...this.members.values()].map((member) => member.nick));
    if (!taken.has(nick)) return nick;
    for (let n = 2; ; n++) {
      const suffix = String(n);
      const candidate = `${nick.slice(0, MAX_NICK_LENGTH - suffix.length)}${suffix}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  join(member: Member): Refusal {
    if (this.clock !== null) return 'the game has started';
    if (this.members.size >= MAX_MEMBERS) return `the room is full at ${MAX_MEMBERS}`;
    this.members.set(member.token, member);
    this.broadcastView();
    return null;
  }

  /** Attach a returning connection to its member and show it where the room stands. */
  reconnect(member: Member): void {
    member.connected = true;
    this.broadcastView();
    if (this.clock !== null) {
      this.deliver(member, { kind: 'start', session: this.sessionFor(member) });
      if (this.clock.running) this.deliver(member, this.clockMessage(null));
    }
  }

  /** Leaving is a lobby action; a running game keeps every seat, and a dropped connection reclaims it. */
  leave(member: Member): Refusal {
    if (this.clock !== null) return 'the game has started';
    this.remove(member);
    return null;
  }

  /** A dropped connection keeps its seat once the game runs; in the lobby it is a leave. */
  disconnect(member: Member): 'left' | 'kept' {
    if (this.clock === null) {
      this.remove(member);
      return 'left';
    }
    member.connected = false;
    this.broadcastView();
    this.startClockWhenLoaded();
    return 'kept';
  }

  claimSeat(member: Member, player: number | null): Refusal {
    if (this.clock !== null) return 'the game has started';
    if (player === null) {
      this.standUp(member);
      this.broadcastView();
      return null;
    }
    const seat = this.seatAt(player);
    if (seat === null) return `no seat ${player}`;
    if (seat.member !== null && seat.member !== member)
      return `seat ${player} is taken by ${seat.member.nick}`;
    this.standUp(member);
    seat.member = member;
    member.seat = player;
    this.broadcastView();
    return null;
  }

  setSeat(member: Member, player: number, change: SeatChange): Refusal {
    if (this.clock !== null) return 'the game has started';
    if (member.token !== this.creatorToken) return 'only the creator sets up seats';
    const seat = this.seatAt(player);
    if (seat === null) return `no seat ${player}`;
    if (change.mode !== undefined) {
      if (seat.member !== null) return `seat ${player} is taken by ${seat.member.nick}`;
      seat.vacantMode = change.mode;
    }
    if (change.color !== undefined) seat.color = change.color;
    this.broadcastView();
    return null;
  }

  setReady(member: Member, ready: boolean): Refusal {
    if (this.clock !== null) return 'the game has started';
    if (member.seat === null) return 'take a seat first';
    member.ready = ready;
    this.broadcastView();
    return null;
  }

  /** Hand every member its own descriptor. The clock starts once they have all built their world. */
  start(member: Member): Refusal {
    if (this.clock !== null) return 'the game has started';
    if (member.token !== this.creatorToken) return 'only the creator starts the game';
    for (const other of this.members.values()) {
      if (other.seat === null) return `${other.nick} has no seat`;
      if (!other.ready) return `${other.nick} is not ready`;
    }
    this.clock = new RoomClock(this.settings.speed);
    this.startedSeats = this.seats.map((seat) => this.sessionSeat(seat));
    this.broadcastView();
    for (const other of this.members.values()) {
      this.deliver(other, { kind: 'start', session: this.sessionFor(other) });
    }
    return null;
  }

  markLoaded(member: Member): Refusal {
    if (this.clock === null) return 'the game has not started';
    member.loaded = true;
    this.startClockWhenLoaded();
    return null;
  }

  submit(member: Member, envelope: WireEnvelope, fromTick: number, delayTicks: number): Refusal {
    if (this.clock === null) return 'the game has not started';
    if (member.seat === null) return 'no seat';
    const stamped: WireEnvelope = { ...envelope, player: member.seat };
    const outcome = this.clock.schedule(member.token, stamped, fromTick, delayTicks);
    return 'refused' in outcome ? `over ${outcome.refused} for that tick` : null;
  }

  setClock(member: Member, speed: number | undefined, paused: boolean | undefined): Refusal {
    if (this.clock === null) return 'the game has not started';
    if (paused === true && !this.clock.paused) {
      if (member.pausesUsed >= PAUSE_BUDGET) return `no pauses left of ${PAUSE_BUDGET}`;
      member.pausesUsed++;
    }
    if (speed !== undefined) this.clock.setSpeed(speed);
    if (paused !== undefined) this.clock.setPaused(paused);
    this.broadcast(this.clockMessage(member.nick));
    return null;
  }

  chat(member: Member, text: string): void {
    this.broadcast({ kind: 'chat', from: member.nick, text });
  }

  advance(elapsedMs: number): void {
    if (this.clock === null) return;
    for (const frame of this.clock.advance(elapsedMs)) this.broadcast({ kind: 'frame', ...frame });
  }

  view(): RoomView {
    const creator = this.members.get(this.creatorToken);
    if (creator === undefined) throw new Error(`room ${this.id} has members but no creator`);
    return {
      id: this.id,
      state: this.state,
      creator: creator.nick,
      settings: this.settings,
      seats: this.seats.map((seat) => this.seatView(seat)),
      members: [...this.members.values()].map((member) => ({
        nick: member.nick,
        seat: member.seat,
        connected: member.connected,
      })),
    };
  }

  summary(): RoomSummary {
    return {
      id: this.id,
      name: this.settings.name,
      state: this.state,
      members: this.members.size,
      seats: this.seats.length,
    };
  }

  private seatAt(player: number): Seat | null {
    return this.seats.find((seat) => seat.player === player) ?? null;
  }

  private remove(member: Member): void {
    this.standUp(member);
    this.members.delete(member.token);
    if (member.token === this.creatorToken) {
      const next = this.members.keys().next();
      if (!next.done) this.creatorToken = next.value;
    }
    this.deliver(member, { kind: 'left' });
    if (this.members.size > 0) this.broadcastView();
  }

  private standUp(member: Member): void {
    if (member.seat === null) return;
    const seat = this.seatAt(member.seat);
    if (seat !== null) seat.member = null;
    member.seat = null;
    member.ready = false;
  }

  private startClockWhenLoaded(): void {
    if (this.clock === null || this.clock.running) return;
    for (const member of this.members.values()) {
      if (member.connected && !member.loaded) return;
    }
    this.clock.start();
    this.broadcast(this.clockMessage(null));
  }

  private clockMessage(by: string | null): ServerMessage {
    if (this.clock === null) throw new Error('no clock before the start');
    return {
      kind: 'clock',
      tick: this.clock.nextTick,
      speed: this.clock.speed,
      paused: this.clock.paused,
      by,
    };
  }

  private sessionFor(member: Member): GameSession {
    if (member.seat === null) throw new Error(`${member.nick} has no seat in a started room`);
    if (this.startedSeats === null) throw new Error('no descriptor before the start');
    return {
      world: this.settings.world,
      seed: this.settings.seed,
      seats: this.startedSeats,
      localSeat: member.seat,
      rules: this.settings.rules,
      speed: this.settings.speed,
    };
  }

  private sessionSeat(seat: Seat): SessionSeat {
    return { player: seat.player, mode: seat.member === null ? seat.vacantMode : 'human', color: seat.color };
  }

  private seatView(seat: Seat): RoomSeatView {
    return {
      ...this.sessionSeat(seat),
      nick: seat.member?.nick ?? null,
      ready: seat.member?.ready ?? false,
    };
  }

  private broadcastView(): void {
    this.broadcast({ kind: 'room', room: this.view() });
  }

  private broadcast(message: ServerMessage): void {
    for (const member of this.members.values()) {
      if (member.connected) this.deliver(member, message);
    }
  }
}
