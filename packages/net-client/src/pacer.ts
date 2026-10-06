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
/** Maximum acceleration of a deep replay at low game speeds. */
const MAX_DRAIN_SCALE = 24;
/** Each tick sends an acknowledgement. Leave 64 of the host's 256 messages/s for other traffic. */
const MAX_CATCH_UP_TICKS_PER_SECOND = 192;

/** The factor on elapsed display time for the frames the transport currently holds. */
export function paceScale(bufferedTicks: number, speed = 1): number {
  if (bufferedTicks < JITTER_BUFFER_TICKS) return REFILL_SCALE;
  if (bufferedTicks <= DRAIN_ABOVE_TICKS) return 1;
  return Math.min(
    MAX_DRAIN_SCALE,
    MAX_CATCH_UP_TICKS_PER_SECOND / (TICKS_PER_SECOND * speed),
    DRAIN_SCALE + (bufferedTicks - DRAIN_ABOVE_TICKS - 1) * DRAIN_SCALE_PER_TICK,
  );
}

import { TICKS_PER_SECOND } from '@open-northland/net-protocol';
