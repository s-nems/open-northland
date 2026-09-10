/** Frames held back before a tick runs: the jitter buffer a late frame lands inside of. */
export const JITTER_BUFFER_TICKS = 2;
/** Frames beyond the buffer that are drained faster rather than tolerated as extra latency. */
const DRAIN_ABOVE_TICKS = JITTER_BUFFER_TICKS + 1;
/** Time scale while the buffer refills: a quarter slower than the frames arrive. */
const REFILL_SCALE = 0.75;
/** Time scale at the first frame of backlog, and its growth per further frame: a served snapshot's
 *  backlog of hundreds of frames must drain well inside the room's kick countdown. */
const DRAIN_SCALE = 1.5;
const DRAIN_SCALE_PER_TICK = 0.25;
/** Two seconds of frames per second: at 60 fps that is the driver's five-steps-per-frame cap, and
 *  past it the per-tick cost of the sim bounds the drain anyway. */
const MAX_DRAIN_SCALE = 24;

/** The factor on elapsed display time for the frames the transport currently holds. */
export function paceScale(bufferedTicks: number): number {
  if (bufferedTicks < JITTER_BUFFER_TICKS) return REFILL_SCALE;
  if (bufferedTicks <= DRAIN_ABOVE_TICKS) return 1;
  return Math.min(
    MAX_DRAIN_SCALE,
    DRAIN_SCALE + (bufferedTicks - DRAIN_ABOVE_TICKS - 1) * DRAIN_SCALE_PER_TICK,
  );
}
