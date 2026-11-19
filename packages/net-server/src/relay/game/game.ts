import {
  type BlobUpload,
  type ClientMessage,
  type DepartedSeatMode,
  type DepartureCause,
  type GovernedClock,
  type PlayerWireEnvelope,
  type ServerMessage,
  SYNC_DOMAINS,
  type WaitReason,
  type WireDigest,
} from '@open-northland/net-protocol';
import type { SyncDomain } from '@open-northland/sim';
import { broadcast, type Deliver, isSilent, isSynced, type Member, type Refusal } from '../member.js';
import { BYTES_PER_KIB, type RelayLog } from '../relay-log.js';
import { blobMessage, relayBlob } from '../snapshots/blob-relay.js';
import type { CachedSnapshot } from '../snapshots/catch-up.js';
import { Resync } from '../snapshots/resync.js';
import { framesIn, governedSpeed, loadSpeedLimit } from '../timing/governor.js';
import { Pacing } from '../timing/pacing.js';
import { RoomClock } from '../timing/room-clock.js';
import { ClockLog } from './clock-log.js';
import { Departures } from './departures.js';
import { type KickOutcome, KickVotes, type PassedKick } from './kick-vote.js';
import { MatchEnd } from './match-end.js';
import { SaveOrders } from './save-orders.js';
import { SyncLedger, type Verdict } from './sync-ledger.js';
import { type Waited, Waiting } from './waiting.js';

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
  private readonly kickVotes = new KickVotes();
  private readonly pacing = new Pacing();
  private readonly resync: Resync;
  private readonly orders: SaveOrders;
  /** The tick the first built world reported; every other world of the room must stand there too. */
  private builtTick: number | null = null;
  private readonly initialSaveTick: number | null;
  private readonly departures: Departures;
  private readonly clockLog: ClockLog;
  /** Who last set the requested speed, and who paused the clock while it is paused, for the log. */
  private speedBy: string | null = null;
  private pausedBy: string | null = null;

  constructor(
    speed: number,
    private readonly members: ReadonlyMap<string, Member>,
    private readonly deliver: Deliver,
    now: number,
    initialSave: CachedSnapshot | null,
    private readonly log: RelayLog,
    /** The room's response reserve: the frames each client holds back before it applies one. */
    private readonly reserveTicks: () => number,
  ) {
    this.initialSaveTick = initialSave?.tick ?? null;
    this.clock = new RoomClock(speed);
    this.end = new MatchEnd(members, deliver);
    this.departures = new Departures(this.clock);
    this.clockLog = new ClockLog(members, log, now);
    this.resync = new Resync(members, deliver, now, log);
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

  get bufferSpeed(): number | null {
    return this.clock.running && !this.clock.paused && !this.waiting.active
      ? (this.clock.governed?.speed ?? this.clock.speed)
      : null;
  }

  get running(): boolean {
    return this.clock.running;
  }

  /** A world has loaded, so the tick the game starts from is fixed. */
  get worldBuilt(): boolean {
    return this.builtTick !== null;
  }

  /** The tick a chat line received now is stamped with: the clock's next one, null before it runs. */
  get chatTick(): number | null {
    return this.clock.running ? this.clock.nextTick : null;
  }

  /** Ticks the member's acknowledgements trail the clock; 0 while the relay does not follow its world
   *  and before the clock runs. */
  behindTicks(member: Member): number {
    if (!this.clock.running || !isSynced(member)) return 0;
    return Math.max(0, this.clock.tick - member.ackedTick);
  }

  get cachedTick(): number | null {
    return this.resync.snapshot?.tick ?? null;
  }

  clockMessage(by: string | null): Extract<ServerMessage, { kind: 'clock' }> {
    return {
      kind: 'clock',
      tick: this.clock.nextTick,
      speed: this.clock.speed,
      paused: this.clock.paused,
      by,
      governed: this.clock.governed,
    };
  }

  /** The clock now and over the interval since the last call, for the room status line. A figure with
   *  nothing to report is left out. */
  statusFields(now: number): Record<string, unknown> {
    const totals = this.clockLog.takeTotals(now);
    const { governed } = this.clock;
    const waited = this.clockLog.waited;
    const holdMs = this.clockLog.holdMs;
    return {
      tick: this.clock.tick,
      speed: this.clock.speed,
      ...(this.speedBy === null ? {} : { speedBy: this.speedBy }),
      ...(this.clock.paused
        ? { paused: true, ...(this.pausedBy === null ? {} : { pausedBy: this.pausedBy }) }
        : {}),
      ...(governed === null ? {} : { governed }),
      ...(waited.length === 0 ? {} : { waitingFor: waited.map(({ nick, reason }) => ({ nick, reason })) }),
      // How long the hold still open has lasted; it gets its `held` line when it ends.
      ...(holdMs === null ? {} : { waitingMs: Math.round(holdMs) }),
      ...(totals.heldMs === 0 ? {} : { holds: totals.holds, heldMs: Math.round(totals.heldMs) }),
      ...(totals.governedMs === 0
        ? {}
        : { governedMs: Math.round(totals.governedMs), minSpeed: totals.minSpeed }),
      ...(totals.pausedMs === 0 ? {} : { pausedMs: Math.round(totals.pausedMs) }),
      ...this.resync.pendingFields(now),
      historyKib: Math.round(this.resync.historyBytes / BYTES_PER_KIB),
    };
  }

  /** The clock stopped for good: a hold or governed run still open ends at `now`. */
  closeClockLog(now: number): void {
    this.clockLog.observe(null, now);
  }

  /** A client's world stands at `tick`, or at nothing: hand it what follows, or the snapshot first. */
  loaded(member: Member, world: Loaded, now: number): Refusal {
    if (member.loaded) return { code: 'alreadyLoaded' };
    this.end.forget(member.token);
    let refusal: Refusal;
    if (world.tick === null) refusal = this.serveSnapshot(member, now);
    else if (member.outOfSync !== null) refusal = { code: 'worldOutOfSync' };
    else if (this.clock.running) refusal = this.catchUp(member, world, now);
    else refusal = this.admitBeforeStart(member, world);
    if (refusal !== null) return refusal;
    const started = this.startClockWhenLoaded(now);
    this.settle(now);
    const told = this.updateWaiting(now) || started;
    const ended = this.end.message;
    if (ended !== null) this.deliver(member, ended);
    // A returning client rebuilt its view with no waited set; one broadcast just now already told it.
    if (!told) this.deliver(member, this.waiting.message(now));
    // A returning or reloaded client rebuilt its view with no tallies, and tallies are sent as they move.
    for (const tally of this.kickVotes.openTallies()) this.deliver(member, tally);
    return null;
  }

  /** An acknowledgement from a world generation other than the one the relay served is still in
   *  flight from before a resync, and says nothing. */
  ack(member: Member, tick: number, digest: WireDigest, world: number, now: number): Refusal {
    if (!member.loaded) return { code: 'notLoaded' };
    if (member.outOfSync !== null || world !== member.world) return null;
    if (tick !== member.ackedTick + 1) return { code: 'ackOutOfOrder', expected: member.ackedTick + 1 };
    if (tick > this.clock.tick) return { code: 'tickNotEmitted', tick };
    member.ackedTick = tick;
    const report = {
      token: member.token,
      nick: member.nick,
      connectedSince: member.connectedSince,
      joinOrder: member.joinOrder,
      digest,
      ...(member.seat === null ? { observer: true } : {}),
    };
    const late = this.ledger.report(tick, report);
    if (late !== null) this.apply(late, now);
    this.settle(now);
    return null;
  }

  submit(member: Member, envelope: PlayerWireEnvelope, fromTick: number): Refusal {
    if (this.builtTick === null) return { code: 'noWorldYet' };
    if (member.seat === null) return { code: 'seatRequired' };
    const stamped: PlayerWireEnvelope = { ...envelope, player: member.seat };
    const outcome = this.clock.schedule(
      member.token,
      stamped,
      fromTick,
      member.delayTicks,
      this.resync.commandHeadroomBytes,
    );
    return 'refused' in outcome ? { code: 'commandBudget' } : null;
  }

  setClock(member: Member, speed: number | undefined, paused: boolean | undefined): Refusal {
    if (member.seat === null) return { code: 'seatRequired' };
    if (speed !== undefined && speed !== this.clock.speed) this.speedBy = member.nick;
    if (paused !== undefined && paused !== this.clock.paused) this.pausedBy = paused ? member.nick : null;
    if (speed !== undefined) this.clock.setSpeed(speed);
    if (paused !== undefined) this.clock.setPaused(paused);
    this.governFor(this.pacedMembers());
    this.broadcast(this.clockMessage(member.nick));
    return null;
  }

  kick(voter: Member, player: number, yes: boolean, now: number): KickOutcome {
    const outcome = this.kickVotes.cast(this.members, this.waiting, voter, player, yes, now, (target) =>
      this.waitedNow(target, now),
    );
    if ('tally' in outcome) this.broadcast(outcome.tally);
    return outcome;
  }

  /** Count the kick votes again after a member dropped, returned or left: broadcast each tally that
   *  moved, and return a vote that now passes for the room to carry out. */
  recountKickVotes(now: number): PassedKick | null {
    const { moved, passed } = this.kickVotes.recount(this.members, this.waiting, now, (target) =>
      this.waitedNow(target, now),
    );
    for (const tally of moved) this.broadcast(tally);
    return passed;
  }

  /** The seat's fallout on the clock: the AI takes it on the next tick, an idle seat just goes quiet.
   *  Returns the tick it takes effect on. */
  kicked(target: Member, player: number, mode: DepartedSeatMode, cause: DepartureCause): number | null {
    return this.departures.schedule({ nick: target.nick, player, mode, cause }, this.builtTick !== null);
  }

  /** A member leaving the room, kicked or not, holds no report, vote, donor role or snapshot wait. */
  forget(member: Member): void {
    this.end.forget(member.token);
    this.ledger.forget(member.token);
    this.resync.forget(member);
    this.waiting.forget(member.token);
    this.kickVotes.forget(member.token);
    this.pacing.forget(member.token);
  }

  /** A former player no longer contributes held votes or digests to the remaining players. */
  observe(member: Member, now: number): void {
    this.ledger.forget(member.token);
    this.kickVotes.forget(member.token);
    this.pacing.forget(member.token);
    this.waiting.forget(member.token);
    this.removed(now);
    this.updateWaiting(now);
  }

  /** The kicked member is out of the room: the rest may be complete now. */
  removed(now: number): void {
    this.startClockWhenLoaded(now);
    this.settle(now);
    this.end.settle();
  }

  /** Snapshots refresh the recovery cache; manual saves are relayed as addressed. */
  blob(sender: Member, upload: BlobUpload, now: number): Refusal {
    if (upload.type === 'snapshot' && upload.world !== sender.world) return null;
    const relayed = (): Refusal =>
      relayBlob(this.members.values(), this.deliver, sender, upload.to, blobMessage(sender, upload));
    if (upload.type === 'map' || upload.tick === null) return relayed();
    const refusal = this.uploadRefusal(sender, upload.type, upload.tick);
    if (upload.type !== 'snapshot') return refusal ?? relayed();
    if (refusal !== null) {
      // The donor's export is wasted, and a refresh it answered still waits.
      this.resync.refused(sender.nick, upload.tick, refusal.code);
      return refusal;
    }
    if (this.resync.take(sender.nick, upload.tick, upload.bytes, now))
      this.ledger.pruneBefore(upload.tick + 1);
    return null;
  }

  /** A snapshot or save stamped with a tick comes from a world in sync, at a tick the clock emitted;
   *  while any seated player remains, a snapshot comes from one. */
  private uploadRefusal(sender: Member, type: BlobUpload['type'], tick: number): Refusal {
    if (!isSynced(sender)) return { code: 'snapshotUnsynced' };
    if (tick < 1 || tick > this.clock.tick) return { code: 'tickNotEmitted', tick };
    if (
      type === 'snapshot' &&
      sender.seat === null &&
      [...this.members.values()].some((member) => member.seat !== null)
    )
      return { code: 'seatRequired' };
    return null;
  }

  /** The member's connection dropped, returned or was replaced: it says where it stands again with
   *  `loaded`. Until then its reports do not count, it is neither expected to acknowledge nor waited
   *  for to start the clock, and it waits for no snapshot. */
  dropWorld(member: Member, now: number): void {
    this.end.forget(member.token);
    this.ledger.forget(member.token);
    this.resync.forget(member);
    member.loaded = false;
    member.loading = null;
    this.startClockWhenLoaded(now);
    this.settle(now);
  }

  advance(elapsedMs: number, now: number): Refusal {
    this.end.settle();
    if (this.end.failure !== null) return this.end.failure;
    this.updateWaiting(now);
    if (!this.clock.running) return null;
    const refusal = this.resync.advance(now);
    if (refusal !== null) return refusal;
    for (const frame of this.clock.advance(elapsedMs)) {
      if (!this.resync.record(frame, now)) return { code: 'historyBytes' };
      this.broadcast({ kind: 'frame', ...frame });
    }
    return null;
  }

  /** A world rebuilt from a snapshot starts with no lag on record; a refused request keeps it. */
  private serveSnapshot(member: Member, now: number): Refusal {
    const snapshot = this.resync.snapshot;
    if (snapshot === null && member.outOfSync === null) return { code: 'noSnapshot' };
    this.pacing.forget(member.token);
    if (snapshot !== null) {
      this.ledger.forget(member.token);
      this.resync.serveReturning(member, snapshot, this.clock.tick, now);
    } else {
      this.resync.queue(member, now);
    }
    return null;
  }

  /** Every world of the room stands where the first built one did; the frames count on from there. */
  private admitBeforeStart(member: Member, world: LoadedWorld): Refusal {
    if (this.initialSaveTick !== null && world.world !== this.initialSaveTick)
      return { code: 'initialSaveGeneration', generation: this.initialSaveTick };
    if (this.builtTick === null) {
      this.builtTick = world.tick;
      this.clock.startAt(world.tick);
      this.departures.flush((message) => this.broadcast(message));
    } else if (world.tick !== this.builtTick) {
      return { code: 'worldTickMismatch', tick: this.builtTick };
    }
    this.admit(member, world);
    return null;
  }

  /** Frames after the tick the world stands at, or the snapshot and the frames after that when the
   *  frames before the snapshot are gone. */
  private catchUp(member: Member, world: LoadedWorld, now: number): Refusal {
    if (this.builtTick !== null && world.tick < this.builtTick) {
      return { code: 'worldBeforeStart', tick: this.builtTick };
    }
    if (world.tick > this.clock.tick) return { code: 'tickNotEmitted', tick: world.tick };
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

  /** Every member the room cannot run without holds the clock; a slow one paces it instead, until it
   *  has stayed slow long enough to hold it too. True when it broadcast the waited set. */
  private updateWaiting(now: number): boolean {
    const waited: Waited[] = [];
    // The donor's acknowledgements queue behind its snapshot on the one link: its lag says nothing of
    // its pace until the upload ends, so its verdict stands still meanwhile.
    const uploading = this.resync.uploadingDonor(now);
    for (const member of this.members.values()) {
      const { figures } = member;
      figures.behindMaxTicks = Math.max(figures.behindMaxTicks, this.behindTicks(member));
      if (member !== uploading && this.absentReason(member, now) === null) {
        this.pacing.observe(
          member.token,
          this.backlogTicks(member),
          this.clock.speed,
          now,
          loadSpeedLimit(member),
        );
      } else {
        this.pacing.hold(member.token, now);
      }
      const reason = this.waitReason(member, now);
      if (reason !== null) waited.push({ token: member.token, nick: member.nick, reason });
    }
    const told = this.waiting.update(waited, now);
    if (told) this.broadcast(this.waiting.message(now));
    for (const tally of this.kickVotes.follow(this.members, this.waiting)) this.broadcast(tally);
    this.clock.hold(waited.length > 0);
    if (this.governFor(this.pacedMembers()) && this.clock.running) this.broadcast(this.clockMessage(null));
    const { clock } = this;
    this.clockLog.observe(
      clock.running
        ? {
            tick: clock.tick,
            speed: clock.speed,
            paused: clock.paused,
            pausedBy: this.pausedBy,
            waited,
            governed: clock.governed,
          }
        : null,
      now,
    );
    return told;
  }

  /** Ticks the member trails beyond the frames a healthy client on its link still has in flight: the
   *  frames of one round trip at the speed they are emitted at, and the reserve it holds back. */
  private backlogTicks(member: Member): number {
    const inFlight = framesIn(member.roundTripMs, this.clock.governed?.speed ?? this.clock.speed);
    return this.clock.tick - member.ackedTick - inFlight - this.reserveTicks();
  }

  /** Pace the clock for members still catching up or limited by load. */
  private governFor(limited: readonly Member[]): boolean {
    const governed = governedSpeed(
      limited,
      this.clock.tick,
      this.clock.speed,
      this.clock.governed,
      this.pacing.isSlow,
    );
    if (sameGoverned(governed, this.clock.governed)) return false;
    this.clock.govern(governed);
    return true;
  }

  private pacedMembers(): Member[] {
    return [...this.members.values()].filter(
      (member) => member.seat !== null && this.pacing.governs(member.token),
    );
  }

  private waitedNow(member: Member, now: number): boolean {
    return this.waitReason(member, now) !== null;
  }

  private waitReason(member: Member, now: number): WaitReason | null {
    if (member.seat === null) return null;
    return this.absentReason(member, now) ?? (this.pacing.waitsFor(member.token, now) ? 'slow' : null);
  }

  /** Why the room cannot run with a seated member at all: the relay does not follow its world. */
  private absentReason(member: Member, now: number): Exclude<WaitReason, 'slow'> | null {
    if (member.seat === null) return null;
    if (!member.connected) return 'gone';
    if (member.outOfSync !== null) return 'resync';
    // A loader that stopped answering is away, not loading: its last progress says nothing now.
    if (isSilent(member, now)) return 'silent';
    return member.loaded ? null : 'loading';
  }

  /** The clock starts once every seated player has loaded, a dropped one included: a game never starts
   *  without one of its players. True when it started and broadcast the waited set. */
  private startClockWhenLoaded(now: number): boolean {
    if (this.clock.running || this.builtTick === null) return false;
    for (const member of this.members.values()) {
      if (member.seat !== null && !member.loaded) return false;
    }
    this.clock.start();
    this.resync.restartCadence(now);
    this.broadcast(this.clockMessage(null));
    this.waiting.restart(now);
    return this.updateWaiting(now);
  }

  /** Judge every tick each client in sync has passed, and drop the references no client can still
   *  report against. */
  private settle(now: number): void {
    const synced = new Set<string>();
    let passed = Number.POSITIVE_INFINITY;
    let lowest = Number.POSITIVE_INFINITY;
    const hasPlayers = [...this.members.values()].some((member) => member.seat !== null);
    for (const member of this.members.values()) {
      if (member.seat !== null || isSynced(member)) lowest = Math.min(lowest, member.ackedTick);
      if (!isSynced(member)) continue;
      synced.add(member.token);
      if (member.seat !== null || !hasPlayers) passed = Math.min(passed, member.ackedTick);
    }
    if (passed === Number.POSITIVE_INFINITY) return;
    for (const verdict of this.ledger.settle(passed, synced)) this.apply(verdict, now);
    this.ledger.pruneBefore(lowest + 1);
  }

  /** Notify each newly diverged member, then tell the reference whom it disagreed with, so both
   *  sides can keep that tick's digest inputs. */
  private apply(verdict: Verdict, now: number): void {
    const diverged: string[] = [];
    const disputedDomains = new Set<SyncDomain>();
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
      this.pacing.forget(token);
      this.deliver(member, notice);
      this.resync.queue(member, now);
      diverged.push(member.nick);
      for (const domain of domains) disputedDomains.add(domain);
    }
    if (diverged.length > 0) {
      this.log('desync', {
        tick: verdict.tick,
        diverged,
        reference: verdict.reference.nick,
        domains: SYNC_DOMAINS.filter((domain) => disputedDomains.has(domain)),
      });
    }
    const reference = this.members.get(verdict.reference.token);
    if (diverged.length === 0 || reference === undefined || !reference.connected) return;
    this.deliver(reference, {
      kind: 'disputed',
      tick: verdict.tick,
      domains: SYNC_DOMAINS.filter((domain) => disputedDomains.has(domain)),
      diverged,
    });
  }

  private broadcast(message: ServerMessage): void {
    broadcast(this.members.values(), this.deliver, message);
  }
}

function sameGoverned(a: GovernedClock | null, b: GovernedClock | null): boolean {
  return (
    a === b || (a !== null && b !== null && a.nick === b.nick && a.speed === b.speed && a.cause === b.cause)
  );
}
