import type { WireFrame } from '@open-northland/net-protocol';
import { type CachedSnapshot, CatchUpStore, HISTORY_REFRESH_AGE_MS } from './catch-up.js';
import { type Deliver, isSynced, type Member, type Refusal } from './member.js';

/** Cadence of the cached snapshot's refresh from the best-connected client. */
export const SNAPSHOT_REFRESH_MS = HISTORY_REFRESH_AGE_MS;
/** A snapshot request unanswered this long is repeated, to the next eligible donor. */
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
  private refreshing = false;
  private readonly triedDonors = new Set<string>();

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

  record(frame: WireFrame, now: number): boolean {
    return this.catchUp.record(frame, now);
  }

  framesAfter(tick: number): readonly WireFrame[] | null {
    return this.catchUp.framesAfter(tick);
  }

  finishAt(tick: number): void {
    this.catchUp.finishAt(tick);
    this.refreshing = true;
    this.requestedAt = null;
    this.triedDonors.clear();
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
    if (this.triedDonors.delete(member.token)) this.requestedAt = null;
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
  take(from: string, tick: number, bytes: string, now: number): boolean {
    const newer = this.catchUp.cache({ tick, from, bytes });
    if (newer || (this.catchUp.bytes === 0 && this.catchUp.snapshot?.tick === tick)) {
      this.lastRefreshAt = now;
      this.refreshing = false;
      this.requestedAt = null;
      this.triedDonors.clear();
    }
    const newest = this.catchUp.snapshot;
    if (newest !== null) {
      for (const member of this.awaiting) if (member.connected) this.serve(member, newest);
    }
    return newer;
  }

  /** Unanswered refreshes retry even when no member is currently waiting for resync. */
  advance(now: number): Refusal {
    if (this.catchUp.expired(now)) return 'snapshot refresh failed: relay replay history age limit';
    let waitingHere = false;
    for (const member of this.awaiting) if (member.connected) waitingHere = true;
    const refreshDue = this.catchUp.needsRefresh(now) || now - this.lastRefreshAt >= SNAPSHOT_REFRESH_MS;
    if (refreshDue && !this.refreshing) {
      this.refreshing = true;
      this.lastRefreshAt = now;
    }
    if (
      (waitingHere || this.refreshing) &&
      (this.requestedAt === null || now - this.requestedAt >= SNAPSHOT_RETRY_MS)
    )
      this.request(now);
    return null;
  }

  private request(now: number): void {
    const eligible = [...this.members.values()].filter(isSynced);
    if (eligible.length === 0) return;
    if (eligible.every((member) => this.triedDonors.has(member.token))) this.triedDonors.clear();
    let donor: Member | null = null;
    for (const member of eligible) {
      if (!this.triedDonors.has(member.token) && (donor === null || member.roundTripMs < donor.roundTripMs)) {
        donor = member;
      }
    }
    if (donor === null) return;
    this.requestedAt = now;
    this.triedDonors.add(donor.token);
    this.deliver(donor, { kind: 'snapshotRequest' });
  }
}
