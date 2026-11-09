import type { GameSession } from '@open-northland/lockstep';
import {
  type BlobUpload,
  type ClientMessage,
  type DepartedSeatMode,
  type DepartureCause,
  type LobbyCompatibility,
  type LobbySettings,
  type PlayerWireEnvelope,
  type ResponsivenessMode,
  type RoomSeatSetup,
  type RoomSettings,
  type RoomState,
  type RoomSummary,
  type RoomView,
  type ServerMessage,
  withFlag,
} from '@open-northland/net-protocol';
import type { Allowance } from '../allowance.js';
import { Game } from '../game/game.js';
import { Lobby } from '../lobby/lobby.js';
import { type SeatChange, SeatTable } from '../lobby/seats.js';
import { LobbyTransfers } from '../lobby/transfers.js';
import { broadcast, type Deliver, figureFields, freshFigures, type Member, type Refusal } from '../member.js';
import { type RelayLog, wholeSeconds } from '../relay-log.js';
import { Responsiveness } from '../timing/responsiveness.js';
import { ChatLog } from './chat-log.js';
import { RoomGate } from './gate.js';
import { roomView, sessionForMember } from './view.js';

/** Least wall time between two room views sent only because a member's load, boot progress, link
 *  measurement or lag moved. A load changes with nearly every acknowledgement; a view per ack would be
 *  a room broadcast per member per tick. */
export const LOAD_VIEW_INTERVAL_MS = 1000;
/** How long one step of a member's boot may take, or the member stay away, before the start hands its
 *  seat over, or ends the room when no other player is left to start it. Generous for a slow machine,
 *  and never shown to the players as a countdown. */
export const LOADING_STALL_MS = 2 * 60 * 1000;

/** The handover notice a kicked member missed while its socket was down, for its token's return. */
export type Farewell = Extract<ServerMessage, { kind: 'kicked' }>;

export interface RoomHooks {
  readonly deliver: Deliver;
  /** A member left, was dropped from the lobby, or was kicked; its token no longer belongs here. */
  readonly removed: (member: Member, farewell: Farewell | null) => void;
  /** The peer address of the member's connection, when the transport knows it. */
  readonly addressOf: (member: Member) => string | undefined;
  /** Unix epoch milliseconds. */
  readonly wallClock: () => number;
  readonly log: RelayLog;
}

/** Why a member's token stopped belonging to the room: a lobby socket loss counts as a departure. */
type RemovalCause = DepartureCause | 'disconnected' | 'banned';

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
  private readonly gate: RoomGate;
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
  /** Monotonic milliseconds of the room's milestones, for the durations its log lines carry. */
  private readonly createdAt: number;
  private startedAt: number | null = null;
  private runningAt: number | null = null;
  private endedAt: number | null = null;
  /** Where the interval the next room status line covers began. */
  private statusSince: number;

  constructor(
    id: string,
    creator: Member,
    settings: RoomSettings,
    seats: readonly RoomSeatSetup[],
    password: string | undefined,
    hooks: RoomHooks,
    now: number,
  ) {
    this.id = id;
    this.createdAt = now;
    this.statusSince = now;
    this.seats = new SeatTable(seats);
    this.creatorToken = creator.token;
    this.hooks = hooks;
    this.gate = new RoomGate(password);
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
    this.log('room created', { by: creator.nick, world: worldName(settings), seats: this.seats.count });
  }

  get state(): RoomState {
    return this.game === null ? 'lobby' : this.game.endedTick === null ? 'running' : 'ended';
  }

  /** The rate that turns link time into future command ticks, including a governed clock. */
  get delaySpeed(): number {
    if (this.game === null) return this.lobby.settings.speed;
    const clock = this.game.clockMessage(null);
    return clock.governed?.speed ?? clock.speed;
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

  /** Every member's nick, a disconnected member's held for its return. */
  nicks(): string[] {
    return [...this.members.values()].map((member) => member.nick);
  }

  /** Show a member that just entered the room the room and its chat so far. */
  welcome(member: Member): void {
    this.broadcastView();
    this.deliver(member, this.chatLog.history());
    this.deliver(member, this.responsiveness.message());
  }

  /** Why a token from `address` may not join with `password`; a wrong or missing one spends one of
   *  the address's `attempts`, and none left refuses even the right one. */
  entryRefusal(
    token: string,
    address: string | undefined,
    password: string | undefined,
    attempts: Allowance,
    now: number,
  ): Refusal {
    if (this.game !== null) return { code: 'gameStarted' };
    if (this.gate.bars(token, address)) return { code: 'banned' };
    if (!this.gate.locked) return null;
    if (!attempts.has(now)) return { code: 'retryTooSoon' };
    if (this.gate.opens(password)) return null;
    attempts.take(now);
    return { code: 'wrongPassword' };
  }

  join(member: Member): Refusal {
    if (this.game !== null) return { code: 'gameStarted' };
    this.admit(member);
    this.log('room joined', { nick: member.nick, members: this.members.size });
    return null;
  }

  /** Attach a returning connection to its member and show it where the room stands. */
  reconnect(member: Member, now: number): void {
    member.connected = true;
    member.connectedSince = now;
    member.lastHeardAt = now;
    if (this.game === null) {
      member.compatibility = null;
      member.ready = false;
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
      this.remove(member, 'left');
      return null;
    }
    if (this.game !== null && this.game.endedTick === null && member.seat !== null) {
      this.kickOut(member, member.seat, now, 'left');
    } else {
      this.remove(member, 'left');
    }
    this.carryOutKickVotes(now);
    return null;
  }

  /** A dropped connection keeps its seat once the game runs; in the lobby it is a leave. */
  disconnect(member: Member, now: number): void {
    if (this.game === null) {
      this.remove(member, 'disconnected');
      return;
    }
    member.connected = false;
    member.progressAt = now;
    member.figures.drops++;
    this.broadcastView();
    this.game.dropWorld(member, now);
    this.carryOutKickVotes(now);
  }

  claimSeat(member: Member, player: number | null, now: number): Refusal {
    if (this.game !== null) {
      if (player !== null) return { code: 'gameStarted' };
      const seat = member.seat;
      if (seat === null) return null;
      this.seats.standUp(member);
      this.seats.vacate(seat, 'idle');
      this.game.observe(member, now);
      this.broadcastView();
      this.carryOutKickVotes(now);
      return null;
    }
    return this.lobby.claimSeat(member, player);
  }

  setSeat(member: Member, player: number, change: SeatChange): Refusal {
    if (this.game !== null) return { code: 'gameStarted' };
    return this.lobby.setSeat(member, player, change);
  }

  moveMember(member: Member, nick: string, player: number | null): Refusal {
    if (this.game !== null) return { code: 'gameStarted' };
    return this.lobby.moveMember(member, nick, player);
  }

  /** The creator removes a lobby member as a leave would, and bars its token and address for the
   *  room's life; the members still inside may come back through that address. */
  ban(member: Member, nick: string): Refusal {
    if (this.game !== null) return { code: 'gameStarted' };
    if (member.token !== this.creatorToken) return { code: 'creatorOnly' };
    const banned = [...this.members.values()].find((other) => other.nick === nick);
    if (banned === undefined) return { code: 'notMember', nick };
    if (banned === member) return { code: 'banSelf' };
    const inside = [...this.members.values()].filter((other) => other !== banned).map((other) => other.token);
    this.gate.ban(banned.token, this.hooks.addressOf(banned), inside);
    this.log('room banned', { by: member.nick, nick });
    this.deliver(banned, { kind: 'error', reason: { code: 'banned' } });
    this.remove(banned, 'banned');
    return null;
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
    // Every client's build matches the creator's by now. Logged before the game takes a save it starts
    // from as its first snapshot.
    const client = this.members.get(this.creatorToken)?.compatibility?.client;
    this.log('game starting', {
      players: [...this.members.values()].map((other) => other.nick),
      world: worldName(this.lobby.settings),
      ...(client === undefined ? {} : { client }),
      lobbySeconds: wholeSeconds(now - this.createdAt),
    });
    this.game = new Game(
      this.lobby.settings.speed,
      this.members,
      this.hooks.deliver,
      now,
      this.transfers.initialSave,
      () => this.broadcastView(),
      (event, fields) => this.log(event, fields),
      () => this.responsiveness.bufferTicks,
    );
    this.transfers.start();
    this.startedSeats = this.seats.sessionSeats();
    this.startedAt = now;
    this.statusSince = now;
    for (const other of this.members.values()) {
      other.progressAt = now;
      other.figures = freshFigures(other);
    }
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
    member.loading = null;
    this.figuresMoved = true;
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
      const { figures } = member;
      figures.tickMaxMs = Math.max(figures.tickMaxMs ?? 0, load.tickMs);
      figures.bufferedMaxTicks = Math.max(figures.bufferedMaxTicks ?? 0, load.buffered);
    }
    return null;
  }

  submit(member: Member, envelope: PlayerWireEnvelope, fromTick: number): Refusal {
    if (this.game === null) return { code: 'gameNotStarted' };
    return this.game.submit(member, envelope, fromTick);
  }

  setResponsiveness(member: Member, mode: ResponsivenessMode): Refusal {
    if (member.seat === null) return { code: 'seatRequired' };
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
    return this.transfers.requestMap(member, now);
  }

  /** A fresh measurement of the member's link: `sampleMs` is the round trip just measured, the rest the
   *  estimates after it. Only a started room shows it before its next view. */
  linkMeasured(
    member: Member,
    sampleMs: number,
    delayTicks: number,
    roundTripMs: number,
    jitterMs: number,
  ): void {
    const { figures } = member;
    figures.roundTrips++;
    figures.roundTripSumMs += sampleMs;
    figures.roundTripMaxMs = Math.max(figures.roundTripMaxMs, sampleMs);
    const changed = member.delayTicks !== delayTicks || member.roundTripMs !== roundTripMs;
    this.retimeLink(member, delayTicks);
    member.roundTripMs = roundTripMs;
    member.jitterMs = jitterMs;
    member.linkMeasured = true;
    if (!changed) return;
    if (this.game !== null) this.figuresMoved = true;
  }

  /** A clock-rate change retimes the same measured link without recording another round trip. */
  retimeLink(member: Member, delayTicks: number): void {
    if (member.delayTicks === delayTicks) return;
    member.delayTicks = delayTicks;
    member.figures.delayMaxTicks = Math.max(member.figures.delayMaxTicks, delayTicks);
    if (this.game !== null) this.figuresMoved = true;
  }

  chat(member: Member, text: string): void {
    this.broadcast(
      this.chatLog.add({
        from: member.nick,
        ...withFlag(member.flag),
        text,
        at: this.hooks.wallClock(),
        tick: this.game?.chatTick ?? null,
      }),
    );
  }

  advance(elapsedMs: number, now: number): Refusal {
    if (this.leftBeforeStart !== null) return { code: 'leftBeforeStart', nick: this.leftBeforeStart };
    if (this.game !== null && !this.game.running) {
      const ended = this.handOverStalledLoads(now);
      if (ended !== null) return ended;
    }
    const refusal = this.game?.advance(elapsedMs, now) ?? null;
    this.noteMilestones(now);
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
      this.gate.locked,
      this.seats,
      this.members,
      (member) => this.behindTicks(member),
    );
  }

  summary(now: number): RoomSummary {
    const state = this.state;
    return {
      id: this.id,
      name: this.lobby.settings.name,
      state,
      members: [...this.members.values()].flatMap((member) => (member.connected ? [member.nick] : [])),
      seats: this.seats.count,
      world: this.lobby.settings.world,
      locked: this.gate.locked,
      playedMs: state === 'running' && this.runningAt !== null ? Math.round(now - this.runningAt) : null,
    };
  }

  /** What a log line about the room's end says about its life. */
  lifeFields(now: number): Record<string, unknown> {
    return {
      state: this.state,
      members: this.members.size,
      ageSeconds: wholeSeconds(now - this.createdAt),
      ...(this.runningAt === null
        ? {}
        : { playedSeconds: wholeSeconds((this.endedAt ?? now) - this.runningAt) }),
    };
  }

  /** The started room's clock, and each member's link and load, over the interval since the last room
   *  status line; the next interval starts here. */
  logStatus(now: number): void {
    if (this.game === null) return;
    this.log('room status', {
      intervalMs: Math.round(now - this.statusSince),
      ...this.game.statusFields(now),
      members: [...this.members.values()].map(figureFields),
    });
    this.statusSince = now;
    for (const member of this.members.values()) member.figures = freshFigures(member);
  }

  /** The clock's start and the match's end happen inside the game; each is logged once, on the first
   *  poll after it or when the room is dropped. The end closes the game's log with a last room status. */
  noteMilestones(now: number): void {
    if (this.game === null) return;
    if (this.runningAt === null && this.game.running) {
      this.runningAt = now;
      this.log('game running', { loadSeconds: wholeSeconds(now - (this.startedAt ?? now)) });
    }
    if (this.endedAt === null && this.game.endedTick !== null) {
      this.endedAt = now;
      this.game.closeClockLog(now);
      this.logStatus(now);
      this.log('game ended', {
        tick: this.game.endedTick,
        playedSeconds: wholeSeconds(now - (this.runningAt ?? now)),
      });
    }
  }

  /** The room is being dropped: a game that has not ended closes its log with a last room status. */
  noteDrop(now: number): void {
    this.noteMilestones(now);
    if (this.game === null || this.state !== 'running') return;
    this.game.closeClockLog(now);
    this.logStatus(now);
  }

  private log(event: string, fields: Record<string, unknown> = {}): void {
    this.hooks.log(event, { room: this.id, name: this.name, ...fields });
  }

  /** Before the clock runs, a player whose boot stood still for `LOADING_STALL_MS` loses its seat the
   *  way a passed kick takes it, so the others start without it. The kick waits for the first built
   *  world, which fixes the tick the handover lands on; until then every other player is still booting
   *  too. With no player left whose boot moves, the room ends and the players host again. */
  private handOverStalledLoads(now: number): Refusal {
    const stalled: Member[] = [];
    let players = 0;
    for (const member of this.members.values()) {
      if (member.seat === null) continue;
      players++;
      if (!member.loaded && now - member.progressAt >= LOADING_STALL_MS) stalled.push(member);
    }
    const [first] = stalled;
    if (first === undefined) return null;
    if (stalled.length === players) return { code: 'loadingTimedOut', nick: first.nick };
    if (this.game === null || !this.game.worldBuilt) return null;
    for (const member of stalled) {
      if (member.seat !== null) this.kickOut(member, member.seat, now, 'loadingTimedOut');
    }
    this.carryOutKickVotes(now);
    return null;
  }

  /** The AI case lands on the clock through the game. */
  private kickOut(target: Member, player: number, now: number, cause: DepartureCause): void {
    const mode = this.seats.departedModeOf(player, this.lobby.settings.kickedSeatMode);
    let farewell: Farewell | null = null;
    if (this.game !== null && mode !== null) {
      const tick = this.game.kicked(target, player, mode, cause);
      if (tick !== null) {
        const notice: Farewell = { kind: 'kicked', player, nick: target.nick, mode, cause, tick };
        this.broadcast(notice);
        if (!target.connected && cause !== 'left') farewell = notice;
      }
    }
    this.seats.standUp(target);
    if (mode !== null) this.seats.vacate(player, mode);
    this.remove(target, cause, mode, farewell);
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
  }

  /** `seatTo` is what a departed player's seat became in the running game. */
  private remove(
    member: Member,
    cause: RemovalCause,
    seatTo: DepartedSeatMode | null = null,
    farewell: Farewell | null = null,
  ): void {
    this.game?.forget(member);
    this.seats.standUp(member);
    this.members.delete(member.token);
    if (member.token === this.creatorToken) {
      const next = this.members.keys().next();
      if (!next.done) this.creatorToken = next.value;
    }
    this.log('room left', {
      nick: member.nick,
      cause,
      state: this.state,
      members: this.members.size,
      ...(seatTo === null ? {} : { seatTo }),
      // Where a boot that stood still stopped, in percent; null when it never reported progress.
      ...(cause === 'loadingTimedOut' ? { loading: member.loading } : {}),
    });
    this.hooks.removed(member, farewell);
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

function worldName(settings: RoomSettings): string {
  return settings.world.kind === 'map' ? settings.world.mapId : settings.world.sceneId;
}
