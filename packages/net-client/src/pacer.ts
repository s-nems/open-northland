import { TICKS_PER_SECOND } from '@open-northland/net-protocol';

/** Frames held back before a tick runs: the jitter buffer a late frame lands inside of. */
export const JITTER_BUFFER_TICKS = 2;
/** Time scale while the buffer refills: a quarter slower than the frames arrive. */
const REFILL_SCALE = 0.75;
/** A smaller target must drain the old reserve even inside the normal one-frame deadband. */
const RETARGET_SCALE = 1.25;
/** Time scale at the first frame of backlog, and its growth per further frame: a served snapshot's
 *  backlog of hundreds of frames must drain well inside the room's kick countdown. */
const DRAIN_SCALE = 1.5;
const DRAIN_SCALE_PER_TICK = 0.25;
/** Maximum acceleration of a deep replay at low game speeds. */
const MAX_DRAIN_SCALE = 24;
/** Each tick sends an acknowledgement. Leave 64 of the host's 256 messages/s for other traffic. */
const MAX_CATCH_UP_TICKS_PER_SECOND = 192;

/** The factor on elapsed display time for the frames the transport currently holds. */
export function paceScale(
  bufferedTicks: number,
  speed = 1,
  targetTicks = JITTER_BUFFER_TICKS,
  shrinking = false,
): number {
  const drainAboveTicks = targetTicks + 1;
  if (bufferedTicks < targetTicks) return REFILL_SCALE;
  if (bufferedTicks <= targetTicks || (!shrinking && bufferedTicks <= drainAboveTicks)) return 1;
  return Math.min(
    MAX_DRAIN_SCALE,
    MAX_CATCH_UP_TICKS_PER_SECOND / (TICKS_PER_SECOND * speed),
    bufferedTicks <= drainAboveTicks
      ? RETARGET_SCALE
      : DRAIN_SCALE + (bufferedTicks - drainAboveTicks - 1) * DRAIN_SCALE_PER_TICK,
  );
}
