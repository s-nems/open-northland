import { TICKS_PER_SECOND } from '@open-northland/net-protocol';

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

  /** A tick ran since the last `begin`; returns the smoothed cost in milliseconds. */
  end(now: number): number {
    const ms = now - this.startedAt;
    const smoothed = this.smoothedMs === null ? ms : this.smoothedMs + SMOOTHING * (ms - this.smoothedMs);
    this.smoothedMs = smoothed;
    return smoothed;
  }
}
