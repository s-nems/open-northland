/**
 * Fixed-timestep driver. The sim advances in whole ticks at a fixed rate while the renderer runs as fast
 * as the display allows and interpolates the leftover fraction, which is what keeps the simulation
 * deterministic regardless of frame rate. Holds no game state and reads no wall clock: the caller passes
 * elapsed milliseconds.
 */
/** Approximation: the base game clock advances at 12 simulation ticks per second. */
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
   * Ticks the cap has discarded since construction, to the nearest whole tick. Dropping the backlog is
   * what stops a death spiral, but an unreported drop makes a requested playback speed a lie: a speed
   * multiplier cannot be delivered below `speed * TICKS_PER_SECOND / maxSteps` fps.
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
    // Rounded, not floored: repeated subtraction leaves the accumulator a hair under a whole multiple,
    // which would under-report every frame.
    if (steps === this.maxStepsPerFrame && this.accumulatorMs > MS_PER_TICK) {
      this.dropped += Math.round(this.accumulatorMs / MS_PER_TICK);
      this.accumulatorMs = 0;
    }
    return this.accumulatorMs / MS_PER_TICK;
  }
}
