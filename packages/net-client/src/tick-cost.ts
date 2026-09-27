import { MAX_REPORTED_TICK_MS, TICKS_PER_SECOND } from '@open-northland/net-protocol';

/** Weight of the newest tick in a smoothed cost: the last second of ticks at normal speed carries
 *  about two thirds of the average, so one slow tick (a save, a collection pause) does not read as a
 *  slow machine. */
const SMOOTHING = 1 / TICKS_PER_SECOND;

/** The smoothed wall time one tick costs this client: its sim's, on the thread that runs it, or its
 *  display's where that is more. */
export class TickCost {
  private simMs: number | null = null;
  private drawnMs: number | null = null;
  private startedAt = 0;
  private chargedMs = 0;

  /** The next tick may start from here. */
  begin(now: number): void {
    this.startedAt = now;
  }

  /** Work for the ticks done outside the span from `begin` to `end`; the next tick carries it. */
  charge(ms: number): void {
    this.chargedMs += ms;
  }

  /** The wall time a tick costs the display, sampled once per drawn frame that took in `ticks`; the
   *  sample weighs as that many ticks would. */
  drawn(ms: number, ticks: number): void {
    this.drawnMs = smoothed(this.drawnMs, ms, ticks);
  }

  /** A tick ran since the last `begin`; returns the smoothed cost in milliseconds. A tick the thread
   *  slept through, such as a suspended laptop's, counts as the longest reportable one, so the
   *  acknowledgement that carries it is not refused. */
  end(now: number): number {
    this.simMs = smoothed(this.simMs, now - this.startedAt + this.chargedMs);
    this.chargedMs = 0;
    return Math.max(this.simMs, this.drawnMs ?? 0);
  }
}

function smoothed(previousMs: number | null, sampleMs: number, ticks = 1): number {
  const ms = Math.min(sampleMs, MAX_REPORTED_TICK_MS);
  if (previousMs === null) return ms;
  const weight = 1 - (1 - SMOOTHING) ** ticks;
  return previousMs + weight * (ms - previousMs);
}
