import { MS_PER_TICK } from '@open-northland/sim';

/**
 * The renderer's interpolation alpha for ticks that arrive from another thread: the fraction of a
 * tick period, at the session's speed, since the last tick arrived, clamped to one tick so a late tick
 * draws the last state rather than extrapolating past it. Held while paused, as the fixed timestep
 * holds it. Times are milliseconds on this thread's clock.
 */
export class ArrivalAlpha {
  private arrivedAtMs: number | null = null;
  private speed: number;
  private paused: boolean;
  private held = 1;

  constructor(speed: number, paused: boolean) {
    this.speed = speed;
    this.paused = paused;
  }

  arrived(nowMs: number): void {
    this.arrivedAtMs = nowMs;
    // A tick that lands while paused is drawn whole: the mirror holds it, and the held fraction was
    // a fraction of the tick before.
    if (this.paused) this.held = 1;
  }

  setPaused(paused: boolean, nowMs: number): void {
    if (paused === this.paused) return;
    if (paused) this.held = this.at(nowMs);
    this.paused = paused;
    if (!paused) this.anchor(this.held, nowMs);
  }

  /** Keeps the alpha continuous: the rest of the current tick runs at the new pace. */
  setSpeed(speed: number, nowMs: number): void {
    const alpha = this.at(nowMs);
    this.speed = speed;
    if (!this.paused) this.anchor(alpha, nowMs);
  }

  at(nowMs: number): number {
    if (this.paused) return this.held;
    if (this.arrivedAtMs === null) return 1;
    return Math.min(Math.max((nowMs - this.arrivedAtMs) / this.periodMs(), 0), 1);
  }

  private anchor(alpha: number, nowMs: number): void {
    this.arrivedAtMs = nowMs - alpha * this.periodMs();
  }

  private periodMs(): number {
    return MS_PER_TICK / this.speed;
  }
}
