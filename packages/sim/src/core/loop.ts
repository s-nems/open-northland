/**
 * Fixed-timestep driver. The sim advances in whole ticks at a fixed rate; the renderer runs as
 * fast as the display allows and interpolates the leftover fraction. This decoupling is what keeps
 * the simulation deterministic regardless of frame rate.
 *
 * This helper is pure timing bookkeeping - it holds no game state and uses no wall-clock itself;
 * the caller passes elapsed milliseconds (so tests can drive it with synthetic time).
 */
/** User-requested fidelity approximation: the base game clock advances at 12 simulation ticks per second. */
export const TICKS_PER_SECOND = 12;
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND;

export class FixedTimestep {
  private accumulatorMs = 0;
  private dropped = 0;
  private readonly maxStepsPerFrame: number;

  constructor(maxStepsPerFrame = 5) {
    this.maxStepsPerFrame = maxStepsPerFrame;
  }

  /**
   * Ticks the cap has discarded since construction, to the nearest whole tick. Dropping the backlog is what stops a death
   * spiral, but an unreported drop makes a requested playback speed a lie: `?speed=10` cannot be
   * delivered below `speed * TICKS_PER_SECOND / maxSteps` fps, and without this counter nothing says so.
   */
  get droppedTicks(): number {
    return this.dropped;
  }

  /** The per-frame step cap that produces those drops. */
  get maxSteps(): number {
    return this.maxStepsPerFrame;
  }

  /**
   * Feed elapsed real time; invoke `step` once per due tick (capped to avoid a death spiral).
   * Returns the interpolation alpha in [0,1) for the renderer to blend prev->current state.
   */
  advance(elapsedMs: number, step: () => void): number {
    this.accumulatorMs += elapsedMs;
    let steps = 0;
    while (this.accumulatorMs >= MS_PER_TICK && steps < this.maxStepsPerFrame) {
      step();
      this.accumulatorMs -= MS_PER_TICK;
      steps++;
    }
    // If we hit the cap, drop backlog rather than spiral. Rounded, not floored: repeated subtraction
    // leaves the accumulator a hair under a whole multiple, which would under-report every frame.
    if (steps === this.maxStepsPerFrame && this.accumulatorMs > MS_PER_TICK) {
      this.dropped += Math.round(this.accumulatorMs / MS_PER_TICK);
      this.accumulatorMs = 0;
    }
    return this.accumulatorMs / MS_PER_TICK;
  }
}
