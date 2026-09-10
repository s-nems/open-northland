import type { GameSession } from '@open-northland/lockstep';
import {
  type ClientMessage,
  MAX_MEMBERS,
  MAX_NICK_LENGTH,
  type PlayerWireEnvelope,
  type RoomSeatSetup,
  type RoomSettings,
  type RoomState,
  type RoomSummary,
  type RoomView,
  type ServerMessage,
  type WireDigest,
} from '@open-northland/net-protocol';
import type { BlobUpload } from './blob-relay.js';
import { Game } from './game.js';
import { broadcast, type Deliver, type Member, type Refusal } from './member.js';
import { type SeatChange, SeatTable } from './seats.js';

export interface RoomHooks {
  readonly deliver: Deliver;
  /** A member left, was dropped from the lobby, or was kicked; its token no longer belongs here. */
  readonly removed: (member: Member) => void;
}

/**
 * One room: its seats, the people in it, and once started its game. Settings belong to the creator
 * until the start; after it there is no host, and any member may drive the clock.
 */
export class Room {
  readonly id: string;
  private readonly settings: RoomSettings;
  private readonly seats: SeatTable;
  private readonly members = new Map<string, Member>();
  /** Owns the settings and the start; passes to the next member when the creator leaves the lobby. */
  private creatorToken: string;
  private readonly hooks: RoomHooks;
  private game: Game | null = null;
  private joined = 0;
  /** The roster as every client built its world; fixed at the start, whatever the seats do after. */
  private startedSeats: GameSession['seats'] | null = null;

  constructor(
    id: string,
    creator: Member,
    settings: RoomSettings,
    seats: readonly RoomSeatSetup[],
    hooks: RoomHooks,
  ) {
    this.id = id;
    this.settings = settings;
    this.seats = new SeatTable(seats);
    this.creatorToken = creator.token;
    this.hooks = hooks;
    this.admit(creator);
  }

  get state(): RoomState {
    return this.game === null ? 'lobby' : 'running';
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
    if (this.game !== null) return 'the game has started';
    if (this.members.size >= MAX_MEMBERS) return `the room is full at ${MAX_MEMBERS}`;
    this.admit(member);
    this.broadcastView();
    return null;
  }

  /** Attach a returning connection to its member and show it where the room stands. */
  reconnect(member: Member, now: number): void {
    member.connected = true;
    member.connectedSince = now;
    member.lastHeardAt = now;
    this.broadcastView();
    if (this.game !== null) {
      if (member.outOfSync !== null) this.deliver(member, member.outOfSync);
      this.deliver(member, {
        kind: 'start',
        session: this.sessionFor(member),
        snapshotTick: this.game.cachedTick,
      });
      if (this.game.running) this.deliver(member, this.game.clockMessage(null));
    }
  }

  /** Leaving is a lobby action; a running game keeps every seat, and a dropped connection reclaims it. */
  leave(member: Member): Refusal {
    if (this.game !== null) return 'the game has started';
    this.remove(member);
    return null;
  }

  /** A dropped connection keeps its seat once the game runs; in the lobby it is a leave. */
  disconnect(member: Member, now: number): void {
    if (this.game === null) {
      this.remove(member);
      return;
    }
    member.connected = false;
    this.broadcastView();
    this.game.disconnect(member, now);
  }

  claimSeat(member: Member, player: number | null): Refusal {
    if (this.game !== null) return 'the game has started';
    if (player === null) this.seats.standUp(member);
    else {
      const refusal = this.seats.claim(member, player);
      if (refusal !== null) return refusal;
    }
    this.broadcastView();
    return null;
  }

  setSeat(member: Member, player: number, change: SeatChange): Refusal {
    if (this.game !== null) return 'the game has started';
    if (member.token !== this.creatorToken) return 'only the creator sets up seats';
    const refusal = this.seats.setUp(player, change);
    if (refusal !== null) return refusal;
    this.broadcastView();
    return null;
  }

  setReady(member: Member, ready: boolean): Refusal {
    if (this.game !== null) return 'the game has started';
    if (member.seat === null) return 'take a seat first';
    member.ready = ready;
    this.broadcastView();
    return null;
  }

  /** Hand every member its descriptor and its input delay. The clock starts once they have all built
   *  their world. */
  start(member: Member, now: number): Refusal {
    if (this.game !== null) return 'the game has started';
    if (member.token !== this.creatorToken) return 'only the creator starts the game';
    for (const other of this.members.values()) {
      if (other.seat === null) return `${other.nick} has no seat`;
      if (!other.ready) return `${other.nick} is not ready`;
    }
    this.game = new Game(this.settings.speed, this.members, this.hooks.deliver, now);
    this.startedSeats = this.seats.sessionSeats();
    this.broadcastView();
    for (const other of this.members.values()) {
      this.deliver(other, { kind: 'start', session: this.sessionFor(other), snapshotTick: null });
      this.deliver(other, { kind: 'delay', ticks: other.delayTicks });
    }
    return null;
  }

  markLoaded(member: Member, world: Extract<ClientMessage, { kind: 'loaded' }>, now: number): Refusal {
    if (this.game === null) return 'the game has not started';
    return this.game.loaded(member, world, now);
  }

  ack(member: Member, tick: number, digest: WireDigest, world: number, now: number): Refusal {
    if (this.game === null) return 'the game has not started';
    return this.game.ack(member, tick, digest, world, now);
  }

  submit(member: Member, envelope: PlayerWireEnvelope, fromTick: number): Refusal {
    if (this.game === null) return 'the game has not started';
    return this.game.submit(member, envelope, fromTick);
  }

  setClock(member: Member, speed: number | undefined, paused: boolean | undefined): Refusal {
    if (this.game === null) return 'the game has not started';
    return this.game.setClock(member, speed, paused);
  }

  /** One yes towards kicking the member in seat `player`; a passing vote empties the seat. */
  kick(member: Member, player: number, now: number): Refusal {
    if (this.game === null) return 'the game has not started';
    const outcome = this.game.kick(member, player, now);
    if ('refused' in outcome) return outcome.refused;
    if (outcome.kicked !== null) this.kickOut(outcome.kicked, player, now);
    return null;
  }

  blob(member: Member, upload: BlobUpload): Refusal {
    if (this.game === null) return 'the game has not started';
    return this.game.blob(member, upload);
  }

  chat(member: Member, text: string): void {
    this.broadcast({ kind: 'chat', from: member.nick, text });
  }

  advance(elapsedMs: number, now: number): void {
    this.game?.advance(elapsedMs, now);
  }

  view(): RoomView {
    const creator = this.members.get(this.creatorToken);
    if (creator === undefined) throw new Error(`room ${this.id} has members but no creator`);
    return {
      id: this.id,
      state: this.state,
      creator: creator.nick,
      settings: this.settings,
      seats: this.seats.views(),
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
      seats: this.seats.count,
    };
  }

  /** The seat returns to its lobby setting; the AI case lands on the clock through the game. */
  private kickOut(target: Member, player: number, now: number): void {
    const mode = this.seats.vacantModeOf(player);
    if (mode === null || this.game === null) return;
    const tick = this.game.kicked(target, player, mode);
    this.broadcast({ kind: 'kicked', player, nick: target.nick, mode, tick });
    this.remove(target);
    this.game.removed(now);
  }

  private admit(member: Member): void {
    member.joinOrder = this.joined++;
    this.members.set(member.token, member);
  }

  private remove(member: Member): void {
    this.seats.standUp(member);
    this.members.delete(member.token);
    if (member.token === this.creatorToken) {
      const next = this.members.keys().next();
      if (!next.done) this.creatorToken = next.value;
    }
    this.deliver(member, { kind: 'left' });
    this.hooks.removed(member);
    if (this.members.size > 0) this.broadcastView();
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

  private deliver(member: Member, message: ServerMessage): void {
    this.hooks.deliver(member, message);
  }

  private broadcastView(): void {
    this.broadcast({ kind: 'room', room: this.view() });
  }

  private broadcast(message: ServerMessage): void {
    broadcast(this.members.values(), this.hooks.deliver, message);
  }
}
