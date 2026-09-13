import { SYNC_DOMAINS, type WireDigest } from '@open-northland/net-protocol';
import type { SyncDomain } from '@open-northland/sim';

export interface DigestReport {
  readonly token: string;
  readonly nick: string;
  /** When this client last connected, then its order of joining; the earlier wins a tie. */
  readonly connectedSince: number;
  readonly joinOrder: number;
  readonly digest: WireDigest;
}

export interface OutOfSync {
  readonly token: string;
  readonly domains: readonly SyncDomain[];
}

/** One compared tick: who the others are measured against, and who diverged from it. */
export interface Verdict {
  readonly tick: number;
  readonly reference: DigestReport;
  readonly outOfSync: readonly OutOfSync[];
}

/**
 * Digests per tick from every client, judged once every client in sync has passed the tick: the
 * majority digest is the reference, a tie goes to the longest-connected client, and a late report is
 * judged against the reference the tick already settled on.
 */
export class SyncLedger {
  private readonly pending = new Map<number, DigestReport[]>();
  private readonly references = new Map<number, DigestReport>();

  /** Record one client's digest. Judged at once against a settled tick, otherwise held; a client
   *  reporting a held tick again speaks for a newer world, and its earlier word is dropped. */
  report(tick: number, entry: DigestReport): Verdict | null {
    const reference = this.references.get(tick);
    if (reference !== undefined) {
      const domains = differing(reference.digest, entry.digest);
      return domains.length === 0 ? null : { tick, reference, outOfSync: [{ token: entry.token, domains }] };
    }
    const reports = this.pending.get(tick);
    if (reports === undefined) {
      this.pending.set(tick, [entry]);
      return null;
    }
    const held = reports.findIndex((report) => report.token === entry.token);
    if (held === -1) reports.push(entry);
    else reports[held] = entry;
    return null;
  }

  /**
   * Settle every held tick up to `passed`, the last tick every client in sync has acknowledged or
   * been moved past, from the reports of `synced` alone; a tick none of them reported is dropped.
   */
  settle(passed: number, synced: ReadonlySet<string>): Verdict[] {
    const due = [...this.pending.keys()].filter((tick) => tick <= passed).sort((a, b) => a - b);
    const verdicts: Verdict[] = [];
    for (const tick of due) {
      const reports = (this.pending.get(tick) ?? []).filter((report) => synced.has(report.token));
      this.pending.delete(tick);
      if (reports.length === 0) continue;
      const verdict = judge(tick, reports);
      this.references.set(tick, verdict.reference);
      if (verdict.outOfSync.length > 0) verdicts.push(verdict);
    }
    return verdicts;
  }

  /** Drop a client's held reports: it is out of sync and will report again from a snapshot. */
  forget(token: string): void {
    for (const [tick, reports] of this.pending) {
      const kept = reports.filter((report) => report.token !== token);
      if (kept.length === 0) this.pending.delete(tick);
      else this.pending.set(tick, kept);
    }
  }

  /** Forget references before `tick`, once no client can report a tick below it. */
  pruneBefore(tick: number): void {
    for (const settled of this.references.keys()) if (settled < tick) this.references.delete(settled);
  }
}

function judge(tick: number, reports: readonly DigestReport[]): Verdict {
  const groups = new Map<string, DigestReport[]>();
  for (const report of reports) {
    const key = SYNC_DOMAINS.map((domain) => report.digest[domain]).join(',');
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [report]);
    else group.push(report);
  }
  let majority: DigestReport[] = [];
  for (const group of groups.values()) {
    if (group.length > majority.length) majority = group;
    else if (group.length === majority.length && seniority(earliest(group), earliest(majority)) < 0) {
      majority = group;
    }
  }
  const reference = earliest(majority);
  const outOfSync = reports
    .filter((report) => !majority.includes(report))
    .map((report) => ({ token: report.token, domains: differing(reference.digest, report.digest) }));
  return { tick, reference, outOfSync };
}

function earliest(group: readonly DigestReport[]): DigestReport {
  return group.reduce((best, report) => (seniority(report, best) < 0 ? report : best));
}

/** Negative when `a` has been connected longer than `b`. */
function seniority(a: DigestReport, b: DigestReport): number {
  return a.connectedSince - b.connectedSince || a.joinOrder - b.joinOrder;
}

function differing(reference: WireDigest, other: WireDigest): SyncDomain[] {
  return SYNC_DOMAINS.filter((domain) => reference[domain] !== other[domain]);
}
