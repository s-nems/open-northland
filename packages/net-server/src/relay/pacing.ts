import { framesIn, GOVERN_RELEASE_MS, LAG_BEHIND_MS, SLOW_AT_ONCE_MS, SLOW_GRACE_MS } from './governor.js';

/**
 * Which members the clock is paced for. A member trailing by more than `LAG_BEHIND_MS` of frames is
 * lagging and catches up alone; one lagging for `SLOW_GRACE_MS` on end, or trailing by more than
 * `SLOW_AT_ONCE_MS`, is slow, and stays slow until it trails by no more than `GOVERN_RELEASE_MS`.
 * Neither is waited for. A hold keeps the verdict: the held clock adds no lag to judge.
 */
export class Pacing {
  /** When each lagging member began to lag, in the relay's milliseconds. */
  private readonly laggingSince = new Map<string, number>();
  private readonly slow = new Set<string>();

  isSlow(token: string): boolean {
    return this.slow.has(token);
  }

  /** Judge a member the relay follows from how many ticks it trails the clock at `requestedSpeed`. */
  observe(token: string, behindTicks: number, requestedSpeed: number, now: number): void {
    if (this.slow.has(token)) {
      if (behindTicks <= framesIn(GOVERN_RELEASE_MS, requestedSpeed)) this.forget(token);
      return;
    }
    if (behindTicks <= framesIn(LAG_BEHIND_MS, requestedSpeed)) {
      this.laggingSince.delete(token);
      return;
    }
    const since = this.laggingSince.get(token) ?? now;
    this.laggingSince.set(token, since);
    if (now - since >= SLOW_GRACE_MS || behindTicks > framesIn(SLOW_AT_ONCE_MS, requestedSpeed))
      this.slow.add(token);
  }

  /** A member that left, or whose world is being replaced, starts with no lag on record. */
  forget(token: string): void {
    this.laggingSince.delete(token);
    this.slow.delete(token);
  }
}
