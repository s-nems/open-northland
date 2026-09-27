import { MAX_REPORTED_TICK_MS, TICKS_PER_SECOND } from '@open-northland/net-protocol';

/** Weight of the newest tick in the smoothed cost: the last second of ticks at normal speed carries
 *  about two thirds of the average, so one slow tick (a save, a collection pause) does not read as a
 *  slow machine. */
const SMOOTHING = 1 / TICKS_PER_SECOND;

/** The smoothed wall time one sim tick costs on the thread that runs it. */
export class TickCost {
  private smoothedMs: number | null = null;
  private startedAt = 0;

  /** The next tick may start from here. */
  begin(now: number): void {
    this.startedAt = now;
  }

  /** A tick ran since the last `begin`; returns the smoothed cost in milliseconds. A tick the thread
   *  slept through, such as a suspended laptop's, counts as the longest reportable one, so the
   *  acknowledgement that carries it is not refused. */
  end(now: number): number {
    const ms = Math.min(now - this.startedAt, MAX_REPORTED_TICK_MS);
    const smoothed = this.smoothedMs === null ? ms : this.smoothedMs + SMOOTHING * (ms - this.smoothedMs);
    this.smoothedMs = smoothed;
    return smoothed;
  }
}
