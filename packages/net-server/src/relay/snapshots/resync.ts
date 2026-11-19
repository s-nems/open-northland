import { TICKS_PER_SECOND, type WireFrame } from '@open-northland/net-protocol';
import { type Deliver, isSilent, isSynced, type Member, type Refusal } from '../member.js';
import { BYTES_PER_KIB, type RelayLog } from '../relay-log.js';
import {
  type CachedSnapshot,
  CatchUpStore,
  HISTORY_REFRESH_AGE_MS,
  MAX_COMMAND_HISTORY_BYTES,
} from './catch-up.js';

/** Cadence of the cached snapshot's refresh from the best-connected client. */
export const SNAPSHOT_REFRESH_MS = HISTORY_REFRESH_AGE_MS;
/** A snapshot request unanswered this long is repeated, to the next eligible donor. */
export const SNAPSHOT_RETRY_MS = 10_000;
/** The longest an asked donor's upload may keep arriving before the request moves on: a large map's
 *  snapshot over a weak uplink outlasts the retry window, and asking the next donor then wastes it. */
export const SNAPSHOT_UPLOAD_MAX_MS = 60_000;
/** Seconds of play at normal speed a returning member replays from the cache rather than hold the room
 *  for a fresh snapshot. At the 25 to 40 ms a developed map's tick costs, that is 3 to 5 s of replay,
 *  about what a donor's export and upload hold the room for. */
const RETURN_REPLAY_SECONDS = 10;
export const RETURN_SNAPSHOT_MAX_TICKS = RETURN_REPLAY_SECONDS * TICKS_PER_SECOND;

/**
 * The room's cached snapshot, the frames since it, and the members waiting to be brought back to
 * the present: an out-of-sync member waits for a fresh snapshot, a returning one takes the cache.
 */
export class Resync {
  private readonly catchUp = new CatchUpStore();
  /** The cache's author was found out of sync. A drop forgets held digests, so its cached tick may
   *  never have been judged: the bytes wait for a replacement while a member in sync can send one. */
  private snapshotInvalid = false;
  /** Connected members only: a dropped one leaves, and asks again with `loaded` on its return. */
  private readonly awaiting = new Set<Member>();
  /** Returning members waiting for a snapshot fresher than the cache, and since when: each takes the
   *  cache when none arrives within the retry window, or when no donor is left to send one. */
  private readonly freshSince = new Map<Member, number>();
  private requestedAt: number | null = null;
  private askedDonor: string | null = null;
  private lastRefreshAt: number;
  private refreshing = false;
  private readonly triedDonors = new Set<string>();
  /** The first request since the cache last answered one, the requests and the unusable uploads
   *  since, and the donors logged as unanswered, for the log. */
  private roundAt: number | null = null;
  private roundAsks = 0;
  private roundRefusals = 0;
  private readonly roundUnanswered = new Set<string>();

  constructor(
    private readonly members: ReadonlyMap<string, Member>,
    private readonly deliver: Deliver,
    now: number,
    private readonly log: RelayLog = () => undefined,
  ) {
    this.lastRefreshAt = now;
  }

  get snapshot(): CachedSnapshot | null {
    return this.catchUp.snapshot;
  }

  get historyBytes(): number {
    return this.catchUp.bytes;
  }

  get commandHeadroomBytes(): number {
    return Math.max(0, MAX_COMMAND_HISTORY_BYTES - this.catchUp.bytes);
  }

  record(frame: WireFrame, now: number): boolean {
    return this.catchUp.record(frame, now);
  }

  framesAfter(tick: number): readonly WireFrame[] | null {
    return this.catchUp.framesAfter(tick);
  }

  /** Start the refresh cadence from the clock's start. */
  restartCadence(now: number): void {
    this.lastRefreshAt = now;
  }

  /** Queue `member` for the next snapshot a client in sync sends; one request at a time serves every
   *  member queued meanwhile, and an unanswered one is repeated on its retry cadence. */
  queue(member: Member, now: number): void {
    if (member.outOfSync !== null && this.catchUp.snapshot?.from === member.nick) this.snapshotInvalid = true;
    this.awaiting.add(member);
    this.releaseUnfitDonor();
    if (this.retryDue(now)) this.request(now);
  }

  /** The member no longer waits, and a donor that dropped cannot answer: the next poll asks another
   *  instead of waiting out the retry. */
  forget(member: Member): void {
    this.awaiting.delete(member);
    this.freshSince.delete(member);
    this.triedDonors.delete(member.token);
    if (this.askedDonor === member.token) {
      this.askedDonor = null;
      this.requestedAt = null;
    }
  }

  /** Bring a member that holds no world to the present: from the cache, or from a fresh snapshot when
   *  the cache trails `clockTick` by more than `RETURN_SNAPSHOT_MAX_TICKS` and a donor can send one.
   *  Members returning together share the one request. */
  serveReturning(member: Member, snapshot: CachedSnapshot, clockTick: number, now: number): void {
    if (clockTick - snapshot.tick > RETURN_SNAPSHOT_MAX_TICKS && this.donors(now).length > 0) {
      if (!this.freshSince.has(member)) this.freshSince.set(member, now);
      this.queue(member, now);
      return;
    }
    this.serve(member, snapshot, now);
  }

  /** Hand `member` the snapshot, or queue it while a held-back cache can still be replaced. */
  serve(member: Member, snapshot: CachedSnapshot, now: number): void {
    // Reusing a discarded generation would make its in-flight reports and uploads current again.
    if (
      (member.outOfSync !== null && snapshot.tick <= member.world) ||
      (this.snapshotInvalid && this.anySynced())
    ) {
      this.queue(member, now);
      return;
    }
    this.deliverCache(member, snapshot);
  }

  /** Send the snapshot and every frame since; `member` stands at the snapshot's tick from here. */
  private deliverCache(member: Member, snapshot: CachedSnapshot): void {
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
    this.freshSince.delete(member);
  }

  /** Take a snapshot at `tick`; true when it is newer than the cached one. Whoever waits is served. */
  take(from: string, tick: number, bytes: string, now: number): boolean {
    const cached = this.catchUp.snapshot;
    const newer = this.catchUp.cache({ tick, from, bytes }, this.snapshotInvalid);
    const answered = newer || (this.catchUp.bytes === 0 && this.catchUp.snapshot?.tick === tick);
    const round = { at: this.roundAt, asks: this.roundAsks, refusals: this.roundRefusals };
    if (answered) {
      this.lastRefreshAt = now;
      this.refreshing = false;
      this.resetRequests();
    }
    const newest = this.catchUp.snapshot;
    // Only an upload at the cached tick vouches for it; an older one leaves an invalidated cache held.
    if (newest?.tick === tick) this.snapshotInvalid = false;
    const waited = [...this.awaiting];
    if (newest !== null) {
      // A late upload no newer than the cache does not end a wait for a fresher one.
      for (const member of this.awaiting) {
        if (newer || !this.freshSince.has(member)) this.serve(member, newest, now);
      }
    }
    if (!answered && newest === cached) {
      this.refused(from, tick, 'stale');
      return newer;
    }
    const served = waited.filter((member) => !this.awaiting.has(member)).map((member) => member.nick);
    this.log('snapshot', {
      from,
      tick,
      kib: Math.round(bytes.length / BYTES_PER_KIB),
      // From the first request: the donor's export and upload, after any donor that did not answer.
      ...(round.at === null ? {} : { askedMs: Math.round(now - round.at) }),
      ...(round.asks > 1 ? { asks: round.asks } : {}),
      ...(round.refusals === 0 ? {} : { refused: round.refusals }),
      ...(served.length === 0 ? {} : { served }),
    });
    return newer;
  }

  /** The round of requests still unanswered, for the room status: how long since its first request,
   *  and how many it took so far. */
  pendingFields(now: number): Record<string, unknown> {
    if (this.roundAt === null) return {};
    return { snapshotPending: { askedMs: Math.round(now - this.roundAt), asks: this.roundAsks } };
  }

  /** An upload the cache cannot use. The first of a round gets a line; the rest, which a client could
   *  send one per message, are counted on the round's `snapshot` line. */
  refused(from: string, tick: number, reason: string): void {
    if (this.roundRefusals++ === 0) this.log('snapshot refused', { from, tick, reason });
  }

  /** Unanswered refreshes retry even when no member is currently waiting for resync. */
  advance(now: number): Refusal {
    if (this.catchUp.expired(now)) return { code: 'historyAge' };
    this.releaseUnfitDonor();
    this.fallBackToCache(now);
    const refreshDue = this.catchUp.needsRefresh(now) || now - this.lastRefreshAt >= SNAPSHOT_REFRESH_MS;
    if (refreshDue && !this.refreshing) {
      this.refreshing = true;
      this.lastRefreshAt = now;
    }
    if ((this.awaiting.size > 0 || this.refreshing) && this.retryDue(now)) this.request(now);
    return null;
  }

  /** The asked donor whose answer is still arriving, heard and within `SNAPSHOT_UPLOAD_MAX_MS` of
   *  the request; null when none. Its acknowledgements wait behind the upload on the same link. */
  uploadingDonor(now: number): Member | null {
    if (this.askedDonor === null || this.requestedAt === null) return null;
    const donor = this.members.get(this.askedDonor);
    if (donor === undefined || donor.receivingBytes === 0 || isSilent(donor, now)) return null;
    return now - this.requestedAt < SNAPSHOT_UPLOAD_MAX_MS ? donor : null;
  }

  /** No request is out, or the one out had its retry window and is not still arriving. */
  private retryDue(now: number): boolean {
    if (this.requestedAt === null) return true;
    return now - this.requestedAt >= SNAPSHOT_RETRY_MS && this.uploadingDonor(now) === null;
  }

  private request(now: number): void {
    const cached = this.catchUp.snapshot;
    if (this.snapshotInvalid && cached !== null && !this.anySynced()) {
      // Nobody can replace the invalidated cache: returning members take it, then answer for the
      // diverged ones.
      for (const member of this.awaiting) {
        if (member.outOfSync === null) this.deliverCache(member, cached);
      }
    }
    const eligible = this.donors(now);
    if (eligible.length === 0) return;
    if (eligible.every((member) => this.triedDonors.has(member.token))) this.triedDonors.clear();
    let donor: Member | null = null;
    for (const member of eligible) {
      if (!this.triedDonors.has(member.token) && (donor === null || member.roundTripMs < donor.roundTripMs)) {
        donor = member;
      }
    }
    if (donor === null) return;
    // A donor still asked when the next is sent nothing in the retry window, or its upload outlasted
    // `SNAPSHOT_UPLOAD_MAX_MS`. Each donor gets one line a round; the round's `snapshot` counts the asks.
    const unanswered = this.askedDonor === null ? undefined : this.members.get(this.askedDonor);
    if (
      unanswered !== undefined &&
      this.requestedAt !== null &&
      !this.roundUnanswered.has(unanswered.token)
    ) {
      this.roundUnanswered.add(unanswered.token);
      this.log('snapshot unanswered', {
        donor: unanswered.nick,
        askedMs: Math.round(now - this.requestedAt),
        ...(unanswered.receivingBytes === 0
          ? {}
          : { receivingKib: Math.round(unanswered.receivingBytes / BYTES_PER_KIB) }),
      });
    }
    this.requestedAt = now;
    this.askedDonor = donor.token;
    this.triedDonors.add(donor.token);
    this.roundAt ??= now;
    this.roundAsks++;
    this.deliver(donor, { kind: 'snapshotRequest' });
  }

  /** While any seated player remains, only seated players donate. */
  private donors(now: number): Member[] {
    const members = [...this.members.values()];
    const hasPlayers = members.some((member) => member.seat !== null);
    return members.filter((member) => canDonate(member, now) && (!hasPlayers || member.seat !== null));
  }

  /** A returning member that waited a retry window for a fresh snapshot, or has no donor left to send
   *  one, takes the cache. */
  private fallBackToCache(now: number): void {
    const cached = this.catchUp.snapshot;
    if (cached === null || this.freshSince.size === 0) return;
    const stranded = this.donors(now).length === 0;
    for (const [member, since] of this.freshSince) {
      if (!stranded && now - since < SNAPSHOT_RETRY_MS) continue;
      this.freshSince.delete(member);
      this.serve(member, cached, now);
    }
  }

  /** A donor that dropped or diverged after the request will not answer it: the request goes on to
   *  the next donor now instead of after the retry. Silence alone does not: the export runs on the
   *  donor's own thread and keeps it silent while it lasts, so asking the next donor then would stall
   *  each member in turn. */
  private releaseUnfitDonor(): void {
    if (this.askedDonor === null) return;
    const donor = this.members.get(this.askedDonor);
    if (donor !== undefined && isSynced(donor)) return;
    this.askedDonor = null;
    this.requestedAt = null;
  }

  private anySynced(): boolean {
    for (const member of this.members.values()) if (isSynced(member)) return true;
    return false;
  }

  private resetRequests(): void {
    this.requestedAt = null;
    this.askedDonor = null;
    this.triedDonors.clear();
    this.roundAt = null;
    this.roundAsks = 0;
    this.roundRefusals = 0;
    this.roundUnanswered.clear();
  }
}

/** In sync and heard: a silent member's round trip is stale, and it may not answer at all. */
function canDonate(member: Member, now: number): boolean {
  return isSynced(member) && !isSilent(member, now);
}
