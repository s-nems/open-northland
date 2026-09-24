import type { GameSession } from '@open-northland/lockstep';
import {
  type ClientMessage,
  type LobbyCompatibility,
  type LobbySettings,
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
import { Lobby } from './lobby.js';
import { LobbyTransfers } from './lobby-transfers.js';
import { broadcast, type Deliver, type Member, type Refusal } from './member.js';
import { roomView, sessionForMember } from './room-view.js';
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
  private readonly lobby: Lobby;
  private readonly transfers: LobbyTransfers;
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
    this.seats = new SeatTable(seats);
    this.creatorToken = creator.token;
    this.hooks = hooks;
    this.lobby = new Lobby(
      settings,
      this.seats,
      this.members,
      () => this.members.get(this.creatorToken) ?? null,
      () => this.broadcastView(),
    );
    this.transfers = new LobbyTransfers(
      () => this.lobby.settings,
      this.members,
      () => this.members.get(this.creatorToken) ?? null,
      hooks.deliver,
    );
    this.admit(creator);
  }

  get state(): RoomState {
    return this.game === null ? 'lobby' : this.game.endedTick === null ? 'running' : 'ended';
  }

  get name(): string {
    return this.lobby.settings.name;
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

  /** A room-unique nick for someone joining as `nick`; the suffix displaces whole code points, so a
   *  nick of astral characters is never cut through a surrogate pair. */
  uniqueNick(nick: string): string {
    const taken = new Set([...this.members.values()].map((member) => member.nick));
    if (!taken.has(nick)) return nick;
    const points = [...nick];
    for (let n = 2; ; n++) {
      const suffix = String(n);
      let kept = points.length;
      while (kept > 0 && points.slice(0, kept).join('').length + suffix.length > MAX_NICK_LENGTH) kept--;
      const candidate = `${points.slice(0, kept).join('')}${suffix}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  join(member: Member): Refusal {
    if (this.game !== null) return 'the game has started';
    if (this.members.size >= MAX_MEMBERS) return `the room is full at ${MAX_MEMBERS}`;
    this.admit(member);
    return null;
  }

  /** Attach a returning connection to its member and show it where the room stands. */
  reconnect(member: Member, now: number): void {
    member.connected = true;
    member.connectedSince = now;
    member.lastHeardAt = now;
    if (this.game === null) {
      member.compatibility = null;
      this.lobby.invalidateReady();
    } else {
      this.game.dropWorld(member, now);
    }
    this.broadcastView();
    if (this.game !== null) {
      if (member.outOfSync !== null) this.deliver(member, member.outOfSync);
      this.deliver(member, {
        kind: 'start',
        session: this.sessionFor(member),
        snapshotTick: this.game.cachedTick,
      });
      if (this.game.running) this.deliver(member, this.game.clockMessage(null));
      const ended = this.game.endedMessage;
      if (ended !== null) this.deliver(member, ended);
    }
  }

  /** Explicit departure releases identity; socket loss alone preserves a running seat for reconnect. */
  leave(member: Member, now: number): Refusal {
    if (this.game !== null && this.game.endedTick === null && member.seat !== null) {
      this.kickOut(member, member.seat, now);
      return null;
    }
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
    this.game.dropWorld(member, now);
  }

  claimSeat(member: Member, player: number | null): Refusal {
    if (this.game !== null) return 'the game has started';
    return this.lobby.claimSeat(member, player);
  }

  setSeat(member: Member, player: number, change: SeatChange): Refusal {
    if (this.game !== null) return 'the game has started';
    return this.lobby.setSeat(member, player, change);
  }

  setReady(member: Member, ready: boolean): Refusal {
    if (this.game !== null) return 'the game has started';
    const refusal = ready ? this.transfers.readyRefusal() : null;
    return refusal ?? this.lobby.setReady(member, ready);
  }

  setCompatibility(member: Member, compatibility: LobbyCompatibility | null): Refusal {
    if (this.game !== null) return 'the game has started';
    return this.lobby.setCompatibility(member, compatibility);
  }

  setSettings(member: Member, settings: LobbySettings): Refusal {
    if (this.game !== null) return 'the game has started';
    return this.lobby.setSettings(member, settings);
  }

  /** Hand every member its descriptor and its input delay. The clock starts once they have all built
   *  their world. */
  start(member: Member, now: number): Refusal {
    if (this.game !== null) return 'the game has started';
    if (member.token !== this.creatorToken) return 'only the creator starts the game';
    const refusal = this.transfers.readyRefusal() ?? this.lobby.startRefusal();
    if (refusal !== null) return refusal;
    this.game = new Game(
      this.lobby.settings.speed,
      this.members,
      this.hooks.deliver,
      now,
      this.transfers.initialSave,
      () => this.broadcastView(),
    );
    this.transfers.release();
    this.startedSeats = this.seats.sessionSeats();
    this.broadcastView();
    for (const other of this.members.values()) {
      this.deliver(other, {
        kind: 'start',
        session: this.sessionFor(other),
        snapshotTick: this.game.cachedTick,
      });
      this.deliver(other, { kind: 'delay', ticks: other.delayTicks });
    }
    return null;
  }

  saveOrders(member: Member, request: Extract<ClientMessage, { kind: 'saveOrders' }>): Refusal {
    if (this.game === null) return 'the game has not started';
    return this.game.saveOrders(member, request);
  }

  finish(member: Member, report: Extract<ClientMessage, { kind: 'finish' }>): Refusal {
    if (this.game === null) return 'the game has not started';
    return this.game.finish(member, report);
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

  blob(member: Member, upload: BlobUpload, now: number): Refusal {
    if (this.game === null) return this.transfers.upload(member, upload);
    if (upload.type === 'map' || upload.type === 'initialSave') return 'lobby files are fixed after start';
    return this.game.blob(member, upload, now);
  }

  requestInitialSave(member: Member, now: number): Refusal {
    if (this.game !== null) return 'the game has started';
    return this.transfers.requestInitialSave(member, now);
  }

  requestMap(member: Member, now: number): Refusal {
    if (this.game !== null) return 'the game has started';
    return this.transfers.requestMap(member, now);
  }

  chat(member: Member, text: string): void {
    this.broadcast({ kind: 'chat', from: member.nick, text });
  }

  advance(elapsedMs: number, now: number): Refusal {
    return this.game?.advance(elapsedMs, now) ?? null;
  }

  view(): RoomView {
    return roomView(this.id, this.state, this.creatorToken, this.lobby.settings, this.seats, this.members);
  }

  summary(): RoomSummary {
    return {
      id: this.id,
      name: this.lobby.settings.name,
      state: this.state,
      members: this.members.size,
      seats: this.seats.count,
    };
  }

  /** The seat returns to its lobby setting; the AI case lands on the clock through the game. */
  private kickOut(target: Member, player: number, now: number): void {
    const mode = this.lobby.settings.kickedSeatMode ?? this.seats.vacantModeOf(player);
    if (this.game !== null && mode !== null) {
      const tick = this.game.kicked(target, player, mode);
      if (tick !== null) this.broadcast({ kind: 'kicked', player, nick: target.nick, mode, tick });
    }
    this.seats.standUp(target);
    if (mode !== null) this.seats.setUp(player, { mode });
    this.remove(target);
    this.game?.removed(now);
  }

  private admit(member: Member): void {
    member.joinOrder = this.joined++;
    this.members.set(member.token, member);
    this.lobby.invalidateReady();
  }

  private remove(member: Member): void {
    this.seats.standUp(member);
    this.members.delete(member.token);
    if (this.game === null) this.lobby.invalidateReady();
    if (member.token === this.creatorToken) {
      const next = this.members.keys().next();
      if (!next.done) this.creatorToken = next.value;
    }
    this.hooks.removed(member);
    this.deliver(member, { kind: 'left' });
    if (this.members.size > 0) this.broadcastView();
  }

  private sessionFor(member: Member): GameSession {
    return sessionForMember(member, this.lobby.settings, this.startedSeats);
  }

  private deliver(member: Member, message: ServerMessage): void {
    this.hooks.deliver(member, message);
  }

  broadcastView(): void {
    this.broadcast({ kind: 'room', room: this.view() });
  }

  private broadcast(message: ServerMessage): void {
    broadcast(this.members.values(), this.hooks.deliver, message);
  }
}
