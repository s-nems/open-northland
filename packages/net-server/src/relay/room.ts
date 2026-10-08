import type { GameSession } from '@open-northland/lockstep';
import {
  type ClientMessage,
  type DepartureCause,
  type LobbyCompatibility,
  type LobbySettings,
  MAX_MEMBERS,
  MAX_NICK_LENGTH,
  type PlayerWireEnvelope,
  type ResponsivenessMode,
  type RoomSeatSetup,
  type RoomSettings,
  type RoomState,
  type RoomSummary,
  type RoomView,
  type ServerMessage,
} from '@open-northland/net-protocol';
import type { BlobUpload } from './blob-relay.js';
import { ChatLog } from './chat-log.js';
import { Game } from './game.js';
import { Lobby } from './lobby.js';
import { LobbyTransfers } from './lobby-transfers.js';
import { broadcast, type Deliver, type Member, type Refusal } from './member.js';
import { Responsiveness } from './responsiveness.js';
import { roomView, sessionForMember } from './room-view.js';
import { type SeatChange, SeatTable } from './seats.js';

/** Least wall time between two room views sent only because a member's load, boot progress, link
 *  measurement or lag moved. A load changes with nearly every acknowledgement; a view per ack would be
 *  a room broadcast per member per tick. */
export const LOAD_VIEW_INTERVAL_MS = 1000;
/** How long one step of a member's boot may take, or the member stay away, before the start gives up
 *  and ends the room. Generous for a slow machine, and never shown to the players as a countdown. */
export const LOADING_STALL_MS = 2 * 60 * 1000;

export interface RoomHooks {
  readonly deliver: Deliver;
  /** A member left, was dropped from the lobby, or was kicked; its token no longer belongs here. */
  readonly removed: (member: Member) => void;
  /** Unix epoch milliseconds. */
  readonly wallClock: () => number;
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
  /** The member that left before the clock ran: a game never starts without one of its players. */
  private leftBeforeStart: string | null = null;
  /** A member's load, boot progress or link measurement moved since the last room view went out. */
  private figuresMoved = false;
  private nextLoadViewAt = 0;
  /** Each member's `behindTicks` as the last room view carried it. */
  private readonly announcedBehind = new Map<string, number>();
  private readonly chatLog = new ChatLog();
  private readonly responsiveness = new Responsiveness();

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

  /** Show a member that just entered the room the room and its chat so far. */
  welcome(member: Member): void {
    this.broadcastView();
    this.deliver(member, this.chatLog.history());
    this.deliver(member, this.responsiveness.message());
  }

  join(member: Member): Refusal {
    if (this.game !== null) return { code: 'gameStarted' };
    if (this.members.size >= MAX_MEMBERS) return { code: 'roomFull', members: MAX_MEMBERS };
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
      member.progressAt = now;
      this.game.dropWorld(member, now);
    }
    this.welcome(member);
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
      this.carryOutKickVotes(now);
    }
  }

  /** Explicit departure releases identity; socket loss alone preserves a running seat for reconnect. */
  leave(member: Member, now: number): Refusal {
    if (this.game !== null && !this.game.running && member.seat !== null) {
      this.leftBeforeStart ??= member.nick;
      this.remove(member);
      return null;
    }
    if (this.game !== null && this.game.endedTick === null && member.seat !== null) {
      this.kickOut(member, member.seat, now, 'left');
    } else {
      this.remove(member);
    }
    this.carryOutKickVotes(now);
    return null;
  }

  /** A dropped connection keeps its seat once the game runs; in the lobby it is a leave. */
  disconnect(member: Member, now: number): void {
    if (this.game === null) {
      this.remove(member);
      return;
    }
    member.connected = false;
    member.progressAt = now;
    this.broadcastView();
    this.game.dropWorld(member, now);
    this.carryOutKickVotes(now);
  }

  claimSeat(member: Member, player: number | null): Refusal {
    if (this.game !== null) return { code: 'gameStarted' };
    return this.lobby.claimSeat(member, player);
  }

  setSeat(member: Member, player: number, change: SeatChange): Refusal {
    if (this.game !== null) return { code: 'gameStarted' };
    return this.lobby.setSeat(member, player, change);
  }

  setReady(member: Member, ready: boolean): Refusal {
    if (this.game !== null) return { code: 'gameStarted' };
    const refusal = ready ? this.transfers.readyRefusal() : null;
    return refusal ?? this.lobby.setReady(member, ready);
  }

  setCompatibility(member: Member, compatibility: LobbyCompatibility | null): Refusal {
    if (this.game !== null) return { code: 'gameStarted' };
    return this.lobby.setCompatibility(member, compatibility);
  }

  setSettings(member: Member, settings: LobbySettings): Refusal {
    if (this.game !== null) return { code: 'gameStarted' };
    return this.lobby.setSettings(member, settings);
  }

  /** Hand every member its descriptor and its input delay. The clock starts once they have all built
   *  their world. */
  start(member: Member, now: number): Refusal {
    if (this.game !== null) return { code: 'gameStarted' };
    if (member.token !== this.creatorToken) return { code: 'creatorOnly' };
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
    for (const other of this.members.values()) other.progressAt = now;
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
    if (this.game === null) return { code: 'gameNotStarted' };
    return this.game.saveOrders(member, request);
  }

  finish(member: Member, report: Extract<ClientMessage, { kind: 'finish' }>): Refusal {
    if (this.game === null) return { code: 'gameNotStarted' };
    return this.game.finish(member, report);
  }

  markLoaded(member: Member, world: Extract<ClientMessage, { kind: 'loaded' }>, now: number): Refusal {
    if (this.game === null) return { code: 'gameNotStarted' };
    // The room ends on its next advance; a world loaded meanwhile must not start the clock.
    if (this.leftBeforeStart !== null) return null;
    const refusal = this.game.loaded(member, world, now);
    if (refusal !== null) return refusal;
    member.progressAt = now;
    if (member.loading !== null) {
      member.loading = null;
      this.figuresMoved = true;
    }
    return null;
  }

  /** Progress from a member whose world has loaded is late and changes nothing. */
  reportLoading(member: Member, progress: number, now: number): Refusal {
    if (this.game === null) return { code: 'gameNotStarted' };
    if (member.loaded || member.loading === progress) return null;
    member.loading = progress;
    member.progressAt = now;
    this.figuresMoved = true;
    return null;
  }

  ack(member: Member, ack: Extract<ClientMessage, { kind: 'ack' }>, now: number): Refusal {
    if (this.game === null) return { code: 'gameNotStarted' };
    const refusal = this.game.ack(member, ack.tick, ack.digest, ack.world, now);
    if (refusal !== null) return refusal;
    if (ack.world !== member.world || member.outOfSync !== null) return null;
    const { load } = ack;
    if (member.load?.tickMs !== load.tickMs || member.load.buffered !== load.buffered) {
      member.load = load;
      this.figuresMoved = true;
    }
    return null;
  }

  submit(member: Member, envelope: PlayerWireEnvelope, fromTick: number): Refusal {
    if (this.game === null) return { code: 'gameNotStarted' };
    return this.game.submit(member, envelope, fromTick);
  }

  setResponsiveness(member: Member, mode: ResponsivenessMode): Refusal {
    if (this.responsiveness.select(mode, member.nick)) this.broadcast(this.responsiveness.message());
    return null;
  }

  setClock(member: Member, speed: number | undefined, paused: boolean | undefined): Refusal {
    if (this.game === null) return { code: 'gameNotStarted' };
    return this.game.setClock(member, speed, paused);
  }

  /** One yes towards kicking the member in seat `player`, or its withdrawal; a passing vote empties
   *  the seat. */
  kick(member: Member, player: number, yes: boolean, now: number): Refusal {
    if (this.game === null) return { code: 'gameNotStarted' };
    const outcome = this.game.kick(member, player, yes, now);
    if ('refused' in outcome) return outcome.refused;
    if (outcome.kicked !== null) {
      this.kickOut(outcome.kicked, player, now, 'vote');
      this.carryOutKickVotes(now);
    }
    return null;
  }

  blob(member: Member, upload: BlobUpload, now: number): Refusal {
    if (this.game === null) return this.transfers.upload(member, upload);
    if (upload.type === 'map' || upload.type === 'initialSave') return { code: 'lobbyFilesFixed' };
    return this.game.blob(member, upload, now);
  }

  requestInitialSave(member: Member, now: number): Refusal {
    if (this.game !== null) return { code: 'gameStarted' };
    return this.transfers.requestInitialSave(member, now);
  }

  requestMap(member: Member, now: number): Refusal {
    if (this.game !== null) return { code: 'gameStarted' };
    return this.transfers.requestMap(member, now);
  }

  /** A fresh measurement of the member's link. Only a started room shows it before its next view. */
  linkMeasured(member: Member, delayTicks: number, roundTripMs: number, jitterMs = 0): void {
    const changed = member.delayTicks !== delayTicks || member.roundTripMs !== roundTripMs;
    member.delayTicks = delayTicks;
    member.roundTripMs = roundTripMs;
    member.jitterMs = jitterMs;
    member.linkMeasured = true;
    if (!changed) return;
    if (this.game !== null) this.figuresMoved = true;
  }

  chat(member: Member, text: string): void {
    this.broadcast(this.chatLog.add({ from: member.nick, text, at: this.hooks.wallClock() }));
  }

  advance(elapsedMs: number, now: number): Refusal {
    if (this.leftBeforeStart !== null) return { code: 'leftBeforeStart', nick: this.leftBeforeStart };
    if (this.game !== null && !this.game.running) {
      const stalled = this.stalledLoad(now);
      if (stalled !== null) return stalled;
    }
    const refusal = this.game?.advance(elapsedMs, now) ?? null;
    if (this.responsiveness.observe(this.members.values(), this.game?.bufferSpeed ?? null, now)) {
      this.broadcast(this.responsiveness.message());
    }
    if (refusal === null && now >= this.nextLoadViewAt && (this.figuresMoved || this.behindMoved())) {
      this.nextLoadViewAt = now + LOAD_VIEW_INTERVAL_MS;
      this.broadcastView();
    }
    return refusal;
  }

  view(): RoomView {
    return roomView(
      this.id,
      this.state,
      this.creatorToken,
      this.lobby.settings,
      this.seats,
      this.members,
      (member) => this.behindTicks(member),
    );
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

  /** Before the clock runs, a member whose boot stood still for `LOADING_STALL_MS` ends the room: a
   *  game never starts without one of its players, so the others host again. */
  private stalledLoad(now: number): Refusal {
    for (const member of this.members.values()) {
      if (!member.loaded && now - member.progressAt >= LOADING_STALL_MS)
        return { code: 'loadingTimedOut', nick: member.nick };
    }
    return null;
  }

  /** The AI case lands on the clock through the game. */
  private kickOut(target: Member, player: number, now: number, cause: DepartureCause): void {
    const mode = this.seats.departedModeOf(player, this.lobby.settings.kickedSeatMode);
    if (this.game !== null && mode !== null) {
      const tick = this.game.kicked(target, player, mode, cause);
      if (tick !== null) this.broadcast({ kind: 'kicked', player, nick: target.nick, mode, cause, tick });
    }
    this.seats.standUp(target);
    if (mode !== null) this.seats.vacate(player, mode);
    this.remove(target);
    this.game?.removed(now);
  }

  /** Kick every member whose vote a change of the connected members made pass; each kick shrinks
   *  the connected set again. */
  private carryOutKickVotes(now: number): void {
    for (let passed = this.game?.recountKickVotes(now) ?? null; passed !== null; ) {
      this.kickOut(passed.target, passed.player, now, 'vote');
      passed = this.game?.recountKickVotes(now) ?? null;
    }
  }

  private admit(member: Member): void {
    member.joinOrder = this.joined++;
    this.members.set(member.token, member);
    this.lobby.invalidateReady();
  }

  private remove(member: Member): void {
    this.game?.forget(member);
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

  private behindTicks(member: Member): number {
    return this.game?.behindTicks(member) ?? 0;
  }

  private behindMoved(): boolean {
    for (const member of this.members.values()) {
      if (this.behindTicks(member) !== (this.announcedBehind.get(member.token) ?? 0)) return true;
    }
    return false;
  }

  private sessionFor(member: Member): GameSession {
    return sessionForMember(member, this.lobby.settings, this.startedSeats);
  }

  private deliver(member: Member, message: ServerMessage): void {
    this.hooks.deliver(member, message);
  }

  broadcastView(): void {
    this.figuresMoved = false;
    this.announcedBehind.clear();
    for (const member of this.members.values())
      this.announcedBehind.set(member.token, this.behindTicks(member));
    this.broadcast({ kind: 'room', room: this.view() });
  }

  private broadcast(message: ServerMessage): void {
    broadcast(this.members.values(), this.hooks.deliver, message);
  }
}
