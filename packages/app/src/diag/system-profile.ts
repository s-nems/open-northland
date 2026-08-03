/**
 * A running per-system cost accumulator (`?debug=profile`) over the sim's instrument seam: one
 * accumulator per system name, so memory stays constant for a session of any length.
 *
 * Share of total is the number to trust. Instrumentation inflates absolute milliseconds roughly
 * uniformly, so the proportions survive it while the totals do not.
 */

/** The `?debug=` value that turns the running profile on. */
export const PROFILE_DEBUG_FLAG = 'profile';

export interface SystemProfileRow {
  readonly name: string;
  readonly calls: number;
  readonly totalMs: number;
  readonly meanMs: number;
  readonly maxMs: number;
  readonly sharePct: number;
}

interface Accumulator {
  calls: number;
  totalMs: number;
  maxMs: number;
}

export class SystemProfile {
  private readonly bySystem = new Map<string, Accumulator>();

  record(name: string, elapsedMs: number): void {
    const entry = this.bySystem.get(name);
    if (entry === undefined) {
      this.bySystem.set(name, { calls: 1, totalMs: elapsedMs, maxMs: elapsedMs });
      return;
    }
    entry.calls++;
    entry.totalMs += elapsedMs;
    if (elapsedMs > entry.maxMs) entry.maxMs = elapsedMs;
  }

  reset(): void {
    this.bySystem.clear();
  }

  /** Rows heaviest total first, ties broken by codepoint order (ICU collation varies by environment). */
  rows(): readonly SystemProfileRow[] {
    const total = [...this.bySystem.values()].reduce((sum, e) => sum + e.totalMs, 0);
    return [...this.bySystem]
      .map(([name, e]) => ({
        name,
        calls: e.calls,
        totalMs: e.totalMs,
        meanMs: e.calls === 0 ? 0 : e.totalMs / e.calls,
        maxMs: e.maxMs,
        sharePct: total === 0 ? 0 : (e.totalMs / total) * 100,
      }))
      .sort((a, b) => b.totalMs - a.totalMs || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
}
