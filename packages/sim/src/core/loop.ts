/**
 * Fixed-timestep driver. The sim advances in whole ticks at a fixed rate; the renderer runs as
 * fast as the display allows and interpolates the leftover fraction. This decoupling is what keeps
 * the simulation deterministic regardless of frame rate.
 *
 * This helper is pure timing bookkeeping — it holds no game state and uses no wall-clock itself;
 * the caller passes elapsed milliseconds (so tests can drive it with synthetic time).
 */
/** User-requested fidelity approximation: the base game clock advances at 12 simulation ticks per second. */
export const TICKS_PER_SECOND = 12;
export const MS_PER_TICK = 1000 / TICKS_PER_SECOND;

export class FixedTimestep {
  private accumulatorMs = 0;
  private readonly maxStepsPerFrame: number;

  constructor(maxStepsPerFrame = 5) {
    this.maxStepsPerFrame = maxStepsPerFrame;
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
    // If we hit the cap, drop backlog rather than spiral.
    if (steps === this.maxStepsPerFrame && this.accumulatorMs > MS_PER_TICK) {
      this.accumulatorMs = 0;
    }
    return this.accumulatorMs / MS_PER_TICK;
  }
}
