import type { WireFrame } from '@open-northland/net-protocol';
import { type CachedSnapshot, CatchUpStore } from './catch-up.js';
import { type Deliver, isSynced, type Member } from './member.js';

/** Cadence of the cached snapshot's refresh from the best-connected client. */
export const SNAPSHOT_REFRESH_MS = 5 * 60_000;
/** A snapshot request unanswered this long is repeated, to whoever is best connected by then. */
export const SNAPSHOT_RETRY_MS = 10_000;

/**
 * The room's cached snapshot, the frames since it, and the members waiting to be brought back to
 * the present: an out-of-sync member waits for a fresh snapshot, a returning one takes the cache.
 */
export class Resync {
  private readonly catchUp = new CatchUpStore();
  private readonly awaiting = new Set<Member>();
  private requestedAt: number | null = null;
  private lastRefreshAt: number;

  constructor(
    private readonly members: ReadonlyMap<string, Member>,
    private readonly deliver: Deliver,
    now: number,
  ) {
    this.lastRefreshAt = now;
  }

  get snapshot(): CachedSnapshot | null {
    return this.catchUp.snapshot;
  }

  record(frame: WireFrame): void {
    this.catchUp.record(frame);
  }

  framesAfter(tick: number): readonly WireFrame[] | null {
    return this.catchUp.framesAfter(tick);
  }

  /** Start the refresh cadence from the clock's start. */
  restartCadence(now: number): void {
    this.lastRefreshAt = now;
  }

  /** Queue `member` for the next snapshot a client in sync sends, and ask for one now. */
  queue(member: Member, now: number): void {
    this.awaiting.add(member);
    this.request(now);
  }

  forget(member: Member): void {
    this.awaiting.delete(member);
  }

  /** Hand `member` the snapshot and every frame since; it stands at the snapshot's tick from here. */
  serve(member: Member, snapshot: CachedSnapshot): void {
    this.deliver(member, {
      kind: 'blob',
      type: 'snapshot',
      from: snapshot.from,
      tick: snapshot.tick,
      bytes: snapshot.bytes,
    });
    for (const frame of this.catchUp.framesAfter(snapshot.tick) ?? []) {
      this.deliver(member, { kind: 'frame', ...frame });
    }
    member.ackedTick = snapshot.tick;
    member.world = snapshot.tick;
    member.outOfSync = null;
    member.loaded = true;
    this.awaiting.delete(member);
  }

  /** Take a snapshot at `tick`; true when it is newer than the cached one. Whoever waits and is
   *  connected is served; a member away for now takes the cache when it returns. */
  take(from: string, tick: number, bytes: string): boolean {
    const newer = this.catchUp.cache({ tick, from, bytes });
    const newest = this.catchUp.snapshot;
    if (newest !== null) {
      for (const member of this.awaiting) if (member.connected) this.serve(member, newest);
    }
    return newer;
  }

  /** Repeat an unanswered request while someone connected waits, and keep the cache on its cadence. */
  advance(now: number): void {
    let waitingHere = false;
    for (const member of this.awaiting) if (member.connected) waitingHere = true;
    const retryDue =
      waitingHere && (this.requestedAt === null || now - this.requestedAt >= SNAPSHOT_RETRY_MS);
    const refreshDue = now - this.lastRefreshAt >= SNAPSHOT_REFRESH_MS;
    if (retryDue || refreshDue) this.request(now);
    if (refreshDue) this.lastRefreshAt = now;
  }

  private request(now: number): void {
    let donor: Member | null = null;
    for (const member of this.members.values()) {
      if (isSynced(member) && (donor === null || member.roundTripMs < donor.roundTripMs)) donor = member;
    }
    if (donor === null) return;
    this.deliver(donor, { kind: 'snapshotRequest' });
    this.requestedAt = now;
  }
}
