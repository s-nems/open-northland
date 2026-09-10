import { TICK_MS } from '@open-northland/net-protocol';

export const INITIAL_INPUT_DELAY_TICKS = 2;
const PING_INTERVAL_MS = 1000;
/** A ping unanswered this long is superseded by the next; round trips up to here are measured. */
const PING_TIMEOUT_MS = 5000;
const MIN_INPUT_DELAY_TICKS = 1;
/** Samples in a row that would all allow a lower delay before it steps down by one tick. */
const LOWER_AFTER_SAMPLES = 10;
/** Weight of the newest sample in the smoothed round trip and jitter. */
const SMOOTHING = 0.25;

/**
 * Ticks between a member issuing a command and its application, budgeted from that member's round
 * trip as `ceil((rtt + jitter) / tick) + 1`: raised on the spot by a spike, lowered one tick at a time
 * once the smoothed trip has allowed it for a while, so the delay a player feels stays put.
 */
export class InputDelayEstimator {
  private smoothedRtt: number | null = null;
  private jitter = 0;
  private lowerStreak = 0;
  private delay = INITIAL_INPUT_DELAY_TICKS;

  get ticks(): number {
    return this.delay;
  }

  get roundTripMs(): number {
    return this.smoothedRtt ?? 0;
  }

  get jitterMs(): number {
    return this.jitter;
  }

  /** Feed one measured round trip; true when the assigned delay changed. */
  sample(rttMs: number): boolean {
    if (this.smoothedRtt === null) {
      this.smoothedRtt = rttMs;
    } else {
      this.jitter += SMOOTHING * (Math.abs(rttMs - this.smoothedRtt) - this.jitter);
      this.smoothedRtt += SMOOTHING * (rttMs - this.smoothedRtt);
    }
    const before = this.delay;
    const spike = delayFor(rttMs, this.jitter);
    if (spike > this.delay) {
      this.delay = spike;
      this.lowerStreak = 0;
    } else if (delayFor(this.smoothedRtt, this.jitter) < this.delay) {
      this.lowerStreak++;
      if (this.lowerStreak >= LOWER_AFTER_SAMPLES) {
        this.delay--;
        this.lowerStreak = 0;
      }
    } else {
      this.lowerStreak = 0;
    }
    return this.delay !== before;
  }
}

function delayFor(rttMs: number, jitterMs: number): number {
  return Math.max(MIN_INPUT_DELAY_TICKS, Math.ceil((rttMs + jitterMs) / TICK_MS) + 1);
}

/** One client's round-trip probe: pings on a cadence, answers by the exact stamp only, delay from the
 *  estimator. */
export class LatencyProbe {
  readonly delay = new InputDelayEstimator();
  private pingSentAt: number | null = null;
  private lastPingAt: number;

  constructor(now: number) {
    this.lastPingAt = now;
  }

  /** The stamp to ping with, when one is due. */
  pingDue(now: number): number | null {
    if (now - this.lastPingAt < PING_INTERVAL_MS) return null;
    if (this.pingSentAt !== null && now - this.pingSentAt < PING_TIMEOUT_MS) return null;
    this.lastPingAt = now;
    this.pingSentAt = now;
    return now;
  }

  /** Take a pong; true when the assigned delay changed. A stamp that is not the outstanding ping is
   *  ignored, so a client cannot shorten its own budget. */
  pong(stamp: number, now: number): boolean {
    if (this.pingSentAt === null || stamp !== this.pingSentAt) return false;
    this.pingSentAt = null;
    return this.delay.sample(now - stamp);
  }
}
