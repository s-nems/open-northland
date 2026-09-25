import {
  type ClientMessage,
  type DepartedSeatMode,
  PAUSE_BUDGET,
  type PlayerWireEnvelope,
  type ServerMessage,
  TICK_MS,
  type WireDigest,
} from '@open-northland/net-protocol';
import { type BlobUpload, relayBlob } from './blob-relay.js';
import type { CachedSnapshot } from './catch-up.js';
import { Departures } from './departures.js';
import { castKickVote, type KickOutcome } from './kick-vote.js';
import { MatchEnd } from './match-end.js';
import { broadcast, type Deliver, isSynced, type Member, type Refusal } from './member.js';
import { Resync } from './resync.js';
import { RoomClock } from './room-clock.js';
import { SaveOrders } from './save-orders.js';
import { SyncLedger, type Verdict } from './sync-ledger.js';
import { type Waited, Waiting } from './waiting.js';

/** Wall time a client may trail the clock before the clock waits for it: that many frames at the
 *  session speed. */
export const WAIT_BEHIND_MS = 2000;
/** Pings unanswered this long make a connection silent, whatever its socket says. */
export const SILENT_AFTER_MS = 4000;

type Loaded = Extract<ClientMessage, { kind: 'loaded' }>;
type LoadedWorld = Loaded & { readonly tick: number };

/**
 * A room after its start: the clock, every client's acknowledged tick and digest, who the clock waits
 * for, and the way back to the present for a client that fell out.
 */
export class Game {
  private readonly clock: RoomClock;
  private readonly end: MatchEnd;
  private readonly ledger = new SyncLedger();
  private readonly waiting = new Waiting();
  private readonly resync: Resync;
  private readonly orders: SaveOrders;
  /** The tick the first built world reported; every other world of the room must stand there too. */
  private builtTick: number | null = null;
  private readonly initialSaveTick: number | null;
  private readonly departures: Departures;

  constructor(
    speed: number,
    private readonly members: ReadonlyMap<string, Member>,
    private readonly deliver: Deliver,
    now: number,
    initialSave: CachedSnapshot | null = null,
    onEnded: () => void = () => {},
  ) {
    this.initialSaveTick = initialSave?.tick ?? null;
    this.clock = new RoomClock(speed);
    this.end = new MatchEnd(this.clock, members, deliver, (tick) => {
      this.resync.finishAt(tick);
      onEnded();
    });
    this.departures = new Departures(this.clock);
    this.resync = new Resync(members, deliver, now);
    this.orders = new SaveOrders(this.clock, this.resync, () => this.builtTick, deliver);
    if (initialSave !== null) {
      this.builtTick = initialSave.tick;
      this.clock.startAt(initialSave.tick);
      this.resync.take(initialSave.from, initialSave.tick, initialSave.bytes, now);
    }
  }

  get endedTick(): number | null {
    return this.end.tick;
  }

  get endedMessage(): Extract<ServerMessage, { kind: 'ended' }> | null {
    return this.end.message;
  }

  saveOrders(member: Member, request: Extract<ClientMessage, { kind: 'saveOrders' }>): Refusal {
    return this.orders.capture(member, request);
  }

  finish(member: Member, report: Extract<ClientMessage, { kind: 'finish' }>): Refusal {
    return this.end.report(member, report);
  }

  get running(): boolean {
    return this.clock.running;
  }

  get cachedTick(): number | null {
    return this.resync.snapshot?.tick ?? null;
  }

  clockMessage(by: string | null): ServerMessage {
    return {
      kind: 'clock',
      tick: this.clock.nextTick,
      speed: this.clock.speed,
      paused: this.clock.paused,
      by,
    };
  }

  /** A client's world stands at `tick`, or at nothing: hand it what follows, or the snapshot first. */
  loaded(member: Member, world: Loaded, now: number): Refusal {
    if (member.loaded) return 'already loaded; a world is reported once per connection';
    this.end.forget(member.token);
    let refusal: Refusal;
    if (world.tick === null) refusal = this.serveSnapshot(member, now);
    else if (member.outOfSync !== null)
      refusal = 'that world is out of sync; ask for the snapshot with a null tick';
    else if (this.clock.running) refusal = this.catchUp(member, world, now);
    else refusal = this.admitBeforeStart(member, world);
    if (refusal !== null) return refusal;
    this.startClockWhenLoaded(now);
    this.settle(now);
    if (this.endedTick === null && this.clock.running) this.updateWaiting(now);
    this.deliver(member, this.end.message ?? this.waiting.message(now));
    return null;
  }

  /** An acknowledgement from a world generation other than the one the relay served is still in
   *  flight from before a resync, and says nothing. */
  ack(member: Member, tick: number, digest: WireDigest, world: number, now: number): Refusal {
    if (!member.loaded) return 'not loaded';
    if (member.outOfSync !== null || world !== member.world) return null;
    if (tick !== member.ackedTick + 1) return `expected an acknowledgement of tick ${member.ackedTick + 1}`;
    if (tick > this.clock.tick) return `tick ${tick} has not been emitted`;
    member.ackedTick = tick;
    const report = {
      token: member.token,
      nick: member.nick,
      connectedSince: member.connectedSince,
      joinOrder: member.joinOrder,
      digest,
    };
    const late = this.ledger.report(tick, report);
    if (late !== null) this.apply(late, now);
    this.settle(now);
    return null;
  }

  submit(member: Member, envelope: PlayerWireEnvelope, fromTick: number): Refusal {
    if (this.endedTick !== null) return 'the match has ended';
    if (this.builtTick === null) return 'no world has loaded yet';
    if (member.seat === null) return 'no seat';
    const stamped: PlayerWireEnvelope = { ...envelope, player: member.seat };
    const outcome = this.clock.schedule(member.token, stamped, fromTick, member.delayTicks);
    return 'refused' in outcome ? `over ${outcome.refused} for that tick` : null;
  }

  setClock(member: Member, speed: number | undefined, paused: boolean | undefined): Refusal {
    if (this.endedTick !== null) return 'the match has ended';
    if (paused === true && !this.clock.paused) {
      if (member.pausesUsed >= PAUSE_BUDGET) return `no pauses left of ${PAUSE_BUDGET}`;
      member.pausesUsed++;
    }
    if (speed !== undefined) this.clock.setSpeed(speed);
    if (paused !== undefined) this.clock.setPaused(paused);
    this.broadcast(this.clockMessage(member.nick));
    return null;
  }

  kick(voter: Member, player: number, now: number): KickOutcome {
    if (this.endedTick !== null) return { refused: 'the match has ended' };
    const outcome = castKickVote(this.members, this.waiting, voter, player, now);
    if ('tally' in outcome) this.broadcast(outcome.tally);
    return outcome;
  }

  /** The seat's fallout on the clock: the AI takes it on the next tick, an idle seat just goes quiet.
   *  Returns the tick it takes effect on. */
  kicked(target: Member, player: number, mode: DepartedSeatMode): number | null {
    return this.departures.schedule({ nick: target.nick, player, mode }, this.builtTick !== null);
  }

  /** A member leaving the room, kicked or not, holds no report, vote, donor role or snapshot wait. */
  forget(member: Member): void {
    this.end.forget(member.token);
    this.ledger.forget(member.token);
    this.resync.forget(member);
    this.waiting.forget(member.token);
  }

  /** The kicked member is out of the room: the rest may be complete now. */
  removed(now: number): void {
    this.startClockWhenLoaded(now);
    this.settle(now);
    this.end.settle();
  }

  /** A snapshot or a save refreshes the cache and reaches whoever waits; a save or a map is relayed. */
  blob(sender: Member, upload: BlobUpload, now: number): Refusal {
    if (upload.type !== 'map' && upload.tick !== null) {
      if (!isSynced(sender)) return 'a snapshot counts from a client in sync only';
      if (upload.tick < 1 || upload.tick > this.clock.tick) return `tick ${upload.tick} has not been emitted`;
      if (upload.type === 'snapshot') {
        if (this.resync.take(sender.nick, upload.tick, upload.bytes, now))
          this.ledger.pruneBefore(upload.tick + 1);
        return null;
      }
    }
    return relayBlob(this.members.values(), this.deliver, sender, upload);
  }

  /** The member's connection dropped, returned or was replaced: it says where it stands again with
   *  `loaded`. Until then its reports do not count, it is neither expected to acknowledge nor waited
   *  for to start the clock, and it waits for no snapshot. */
  dropWorld(member: Member, now: number): void {
    this.end.forget(member.token);
    this.ledger.forget(member.token);
    this.resync.forget(member);
    member.loaded = false;
    this.startClockWhenLoaded(now);
    this.settle(now);
  }

  advance(elapsedMs: number, now: number): Refusal {
    this.end.settle();
    if (this.end.failure !== null) return this.end.failure;
    if (this.endedTick !== null) return this.resync.advance(now);
    this.updateWaiting(now);
    if (!this.clock.running) return null;
    const refusal = this.resync.advance(now);
    if (refusal !== null) return refusal;
    for (const frame of this.clock.advance(elapsedMs)) {
      if (this.endedTick !== null) break;
      if (!this.resync.record(frame, now)) return 'snapshot refresh failed: relay replay history byte limit';
      this.broadcast({ kind: 'frame', ...frame });
    }
    return null;
  }

  private serveSnapshot(member: Member, now: number): Refusal {
    const snapshot = this.resync.snapshot;
    if (snapshot !== null) {
      this.ledger.forget(member.token);
      this.resync.serve(member, snapshot);
    } else if (member.outOfSync === null) {
      return 'no snapshot is cached; build the world from the descriptor';
    } else {
      this.resync.queue(member, now);
    }
    return null;
  }

  /** Every world of the room stands where the first built one did; the frames count on from there. */
  private admitBeforeStart(member: Member, world: LoadedWorld): Refusal {
    if (this.initialSaveTick !== null && world.world !== this.initialSaveTick)
      return `initial save worlds must use generation ${this.initialSaveTick}`;
    if (this.builtTick === null) {
      this.builtTick = world.tick;
      this.clock.startAt(world.tick);
      this.departures.flush((message) => this.broadcast(message));
    } else if (world.tick !== this.builtTick) {
      return `every world of this room stands at tick ${this.builtTick} before the start`;
    }
    this.admit(member, world);
    return null;
  }

  /** Frames after the tick the world stands at, or the snapshot and the frames after that when the
   *  frames before the snapshot are gone. */
  private catchUp(member: Member, world: LoadedWorld, now: number): Refusal {
    if (this.builtTick !== null && world.tick < this.builtTick) {
      return `no world of this room stands before tick ${this.builtTick}`;
    }
    if (world.tick > this.clock.tick) return `tick ${world.tick} has not been emitted`;
    const frames = this.resync.framesAfter(world.tick);
    if (frames === null) return this.serveSnapshot(member, now);
    this.admit(member, world);
    for (const frame of frames) this.deliver(member, { kind: 'frame', ...frame });
    return null;
  }

  /** Reports held from the world this one replaces say nothing about it. */
  private admit(member: Member, world: LoadedWorld): void {
    this.ledger.forget(member.token);
    member.ackedTick = world.tick;
    member.world = world.world;
    member.loaded = true;
  }

  private updateWaiting(now: number): void {
    const lagTicks = Math.ceil((WAIT_BEHIND_MS / TICK_MS) * this.clock.speed);
    const waited: Waited[] = [];
    for (const member of this.members.values()) {
      const reason = !member.connected
        ? 'gone'
        : member.outOfSync !== null
          ? 'resync'
          : !member.loaded
            ? 'loading'
            : now - member.lastHeardAt > SILENT_AFTER_MS
              ? 'silent'
              : this.clock.tick - member.ackedTick > lagTicks
                ? 'lagging'
                : null;
      if (reason !== null) waited.push({ token: member.token, nick: member.nick, reason });
    }
    if (this.waiting.update(waited, now)) this.broadcast(this.waiting.message(now));
    this.clock.hold(this.waiting.active);
  }

  /** The clock starts once a world has been admitted and every connected member has loaded. */
  private startClockWhenLoaded(now: number): void {
    if (this.clock.running || this.builtTick === null) return;
    for (const member of this.members.values()) {
      if (member.connected && !member.loaded) return;
    }
    this.clock.start();
    this.resync.restartCadence(now);
    this.broadcast(this.clockMessage(null));
  }

  /** Judge every tick each client in sync has passed, and drop the references no client can still
   *  report against. */
  private settle(now: number): void {
    const synced = new Set<string>();
    let passed = Number.POSITIVE_INFINITY;
    let lowest = Number.POSITIVE_INFINITY;
    for (const member of this.members.values()) {
      lowest = Math.min(lowest, member.ackedTick);
      if (!isSynced(member)) continue;
      synced.add(member.token);
      passed = Math.min(passed, member.ackedTick);
    }
    if (synced.size === 0) return;
    for (const verdict of this.ledger.settle(passed, synced)) this.apply(verdict, now);
    this.ledger.pruneBefore(lowest + 1);
  }

  private apply(verdict: Verdict, now: number): void {
    for (const { token, domains } of verdict.outOfSync) {
      const member = this.members.get(token);
      if (member === undefined || member.outOfSync !== null) continue;
      const notice = {
        kind: 'desync',
        tick: verdict.tick,
        domains,
        reference: verdict.reference.nick,
      } as const;
      member.outOfSync = notice;
      this.end.forget(token);
      this.ledger.forget(token);
      this.deliver(member, notice);
      this.resync.queue(member, now);
    }
  }

  private broadcast(message: ServerMessage): void {
    broadcast(this.members.values(), this.deliver, message);
  }
}
