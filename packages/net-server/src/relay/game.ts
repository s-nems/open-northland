import {
  type ClientMessage,
  ENVELOPE_VERSION,
  PAUSE_BUDGET,
  type PlayerWireEnvelope,
  type ServerMessage,
  TICK_MS,
  type VacantSeatMode,
  type WireDigest,
} from '@open-northland/net-protocol';
import { type BlobUpload, relayBlob } from './blob-relay.js';
import { castKickVote, type KickOutcome } from './kick-vote.js';
import { broadcast, type Deliver, isSynced, type Member, type Refusal } from './member.js';
import { Resync } from './resync.js';
import { RoomClock } from './room-clock.js';
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
  private readonly ledger = new SyncLedger();
  private readonly waiting = new Waiting();
  private readonly resync: Resync;
  /** The tick the first built world reported; every other world of the room must stand there too. */
  private builtTick: number | null = null;

  constructor(
    speed: number,
    private readonly members: ReadonlyMap<string, Member>,
    private readonly deliver: Deliver,
    now: number,
  ) {
    this.clock = new RoomClock(speed);
    this.resync = new Resync(members, deliver, now);
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
    let refusal: Refusal;
    if (world.tick === null) refusal = this.serveSnapshot(member);
    else if (member.outOfSync !== null)
      refusal = 'that world is out of sync; ask for the snapshot with a null tick';
    else if (this.clock.running) refusal = this.catchUp(member, world);
    else refusal = this.admitBeforeStart(member, world);
    if (refusal !== null) return refusal;
    this.startClockWhenLoaded(now);
    this.settle(now);
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
    if (member.seat === null) return 'no seat';
    const stamped: PlayerWireEnvelope = { ...envelope, player: member.seat };
    const outcome = this.clock.schedule(member.token, stamped, fromTick, member.delayTicks);
    return 'refused' in outcome ? `over ${outcome.refused} for that tick` : null;
  }

  setClock(member: Member, speed: number | undefined, paused: boolean | undefined): Refusal {
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
    const outcome = castKickVote(this.members, this.waiting, voter, player, now);
    if ('tally' in outcome) this.broadcast(outcome.tally);
    return outcome;
  }

  /** The seat's fallout on the clock: the AI takes it on the next tick, an idle seat just goes quiet.
   *  Returns the tick it takes effect on. */
  kicked(target: Member, player: number, mode: VacantSeatMode): number {
    this.ledger.forget(target.token);
    this.resync.forget(target);
    if (mode !== 'ai') return this.clock.nextTick;
    return this.clock.scheduleTrusted({
      v: ENVELOPE_VERSION,
      origin: 'admin',
      command: { kind: 'setPlayerAi', player, enabled: true },
    });
  }

  /** The kicked member is out of the room: the rest may be complete now. */
  removed(now: number): void {
    this.startClockWhenLoaded(now);
    this.settle(now);
  }

  /** A snapshot or a save refreshes the cache and reaches whoever waits; a save or a map is relayed. */
  blob(sender: Member, upload: BlobUpload): Refusal {
    if (upload.type !== 'map' && upload.tick !== null) {
      if (!isSynced(sender)) return 'a snapshot counts from a client in sync only';
      if (upload.tick < 1 || upload.tick > this.clock.tick) return `tick ${upload.tick} has not been emitted`;
      if (this.resync.take(sender.nick, upload.tick, upload.bytes)) this.ledger.pruneBefore(upload.tick + 1);
      if (upload.type === 'snapshot') return null;
    }
    return relayBlob(this.members.values(), this.deliver, sender, upload);
  }

  /** The member says where it stands again on its return; until then it is neither expected to
   *  acknowledge nor waited for to start the clock. */
  disconnect(member: Member, now: number): void {
    member.loaded = false;
    this.startClockWhenLoaded(now);
    this.settle(now);
  }

  advance(elapsedMs: number, now: number): void {
    this.updateWaiting(now);
    if (!this.clock.running) return;
    for (const frame of this.clock.advance(elapsedMs)) {
      this.resync.record(frame);
      this.broadcast({ kind: 'frame', ...frame });
    }
    this.resync.advance(now);
  }

  private serveSnapshot(member: Member): Refusal {
    const snapshot = this.resync.snapshot;
    if (snapshot !== null) this.resync.serve(member, snapshot);
    else if (member.outOfSync === null) return 'no snapshot is cached; build the world from the descriptor';
    return null;
  }

  /** Every world of the room stands where the first built one did; the frames count on from there. */
  private admitBeforeStart(member: Member, world: LoadedWorld): Refusal {
    if (this.builtTick === null) {
      this.builtTick = world.tick;
      this.clock.startAt(world.tick);
    } else if (world.tick !== this.builtTick) {
      return `every world of this room stands at tick ${this.builtTick} before the start`;
    }
    this.admit(member, world);
    return null;
  }

  /** Frames after the tick the world stands at, or the snapshot and the frames after that when the
   *  frames before the snapshot are gone. */
  private catchUp(member: Member, world: LoadedWorld): Refusal {
    if (this.builtTick !== null && world.tick < this.builtTick) {
      return `no world of this room stands before tick ${this.builtTick}`;
    }
    if (world.tick > this.clock.tick) return `tick ${world.tick} has not been emitted`;
    const frames = this.resync.framesAfter(world.tick);
    if (frames === null) return this.serveSnapshot(member);
    this.admit(member, world);
    for (const frame of frames) this.deliver(member, { kind: 'frame', ...frame });
    return null;
  }

  private admit(member: Member, world: LoadedWorld): void {
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
    if (this.waiting.update(waited, now)) {
      this.broadcast({
        kind: 'waiting',
        for: waited.map(({ token, nick, reason }) => ({
          nick,
          reason,
          voteAfterMs: this.waiting.voteAfterMs(token, now),
        })),
      });
    }
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
      this.ledger.forget(token);
      this.deliver(member, notice);
      this.resync.queue(member, now);
    }
  }

  private broadcast(message: ServerMessage): void {
    broadcast(this.members.values(), this.deliver, message);
  }
}
