import { framesIn, GOVERN_RELEASE_MS, LAG_BEHIND_MS, SLOW_AT_ONCE_MS, SLOW_GRACE_MS } from './governor.js';

/**
 * Which members the clock is paced for. A member trailing by more than `LAG_BEHIND_MS` of frames is
 * lagging and catches up alone; one lagging for `SLOW_GRACE_MS` on end, or trailing by more than
 * `SLOW_AT_ONCE_MS`, is slow, and stays slow until it trails by no more than `GOVERN_RELEASE_MS`.
 * Neither is waited for. A hold on a member keeps its verdict and pauses its grace: wall time under a
 * hold does not count as lagging.
 */
export class Pacing {
  /** When each lagging member began to lag, in the relay's milliseconds. */
  private readonly laggingSince = new Map<string, number>();
  /** Milliseconds each lagging member had lagged when its hold began, while the hold lasts. */
  private readonly laggedBeforeHold = new Map<string, number>();
  private readonly slow = new Set<string>();

  isSlow(token: string): boolean {
    return this.slow.has(token);
  }

  /** The clock waits for the member at `now`: its grace stops until the next `observe`. */
  hold(token: string, now: number): void {
    const since = this.laggingSince.get(token);
    if (since === undefined) return;
    this.laggedBeforeHold.set(token, now - since);
    this.laggingSince.delete(token);
  }

  /** Judge a member the relay follows from how many ticks it trails the clock at `requestedSpeed`. */
  observe(token: string, behindTicks: number, requestedSpeed: number, now: number): void {
    const lagged = this.laggedBeforeHold.get(token);
    if (lagged !== undefined) {
      this.laggedBeforeHold.delete(token);
      this.laggingSince.set(token, now - lagged);
    }
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
    this.laggedBeforeHold.delete(token);
    this.slow.delete(token);
  }
}
