import { type GovernedClock, type GovernorCause, TICK_MS } from '@open-northland/net-protocol';
import type { Member } from './member.js';

/** Wall time a client may trail the clock, as frames at the requested speed, before it is lagging. A
 *  lagging client catches up alone; the room notices it only once it has stayed lagging. */
export const LAG_BEHIND_MS = 1000;
/** Wall time a client stays lagging, continuously, before it is slow and the clock is paced for it. */
export const SLOW_GRACE_MS = 4000;
/** A slow client is released once it trails by no more than this; lower than `LAG_BEHIND_MS` so a
 *  client near the threshold does not flip every advance. */
export const GOVERN_RELEASE_MS = 500;
/** The share of a slow client's sustainable speed the clock runs at, leaving it room to catch up. */
export const GOVERNOR_HEADROOM = 0.8;
/** The most a slow client's governed speed may be, as a share of the requested speed: a client whose
 *  load says it keeps up still trails, so the clock slows enough for it to close the gap. */
export const CATCH_UP_SHARE = 0.8;
/** The floor of a governed clock; a client slower than this falls further behind at it. */
export const MIN_GOVERNED_SPEED = 0.25;
/** A governed speed is rounded to this, so the relay and the clients run the same announced value. */
export const GOVERNED_SPEED_STEP = 0.05;
/** Steps a governed speed must rise by before the clock speeds up; it slows at once. A load report
 *  jittering across one rounding boundary therefore sends no clock message. */
export const GOVERNED_RISE_STEPS = 2;

/** Frames the clock emits in `ms` of wall time at `speed`, rounded up. */
export function framesIn(ms: number, speed: number): number {
  return Math.ceil((ms / TICK_MS) * speed);
}

/**
 * The speed the clock runs at for the slowest of `slow`, or null when none is slow. A member's bound is
 * the lower of two: the headroom share of the speed its reported tick cost exactly saturates (the
 * headroom share of the requested speed before its first report), and the catch-up share of the
 * requested speed. `cause` names the binding one, `lag` on a tie. The speed is rounded to whole steps
 * and kept within `MIN_GOVERNED_SPEED` and the requested speed. The lowest speed wins; a tie goes to
 * the member furthest behind. A rise from `current` under `GOVERNED_RISE_STEPS` steps is ignored.
 */
export function governedSpeed(
  slow: Iterable<Member>,
  clockTick: number,
  requestedSpeed: number,
  current: GovernedClock | null = null,
): GovernedClock | null {
  let limiter: (GovernedClock & { readonly lag: number }) | null = null;
  for (const member of slow) {
    const { speed, cause } = memberBound(member, requestedSpeed);
    const lag = clockTick - member.ackedTick;
    if (limiter === null || speed < limiter.speed || (speed === limiter.speed && lag > limiter.lag))
      limiter = { nick: member.nick, speed, cause, lag };
  }
  if (limiter === null) return null;
  const speed = current === null ? limiter.speed : withoutSmallRise(limiter.speed, current.speed);
  return { nick: limiter.nick, speed: Math.min(speed, requestedSpeed), cause: limiter.cause };
}

function memberBound(
  member: Member,
  requestedSpeed: number,
): { readonly speed: number; readonly cause: GovernorCause } {
  const loadBound =
    member.load === null
      ? requestedSpeed * GOVERNOR_HEADROOM
      : (TICK_MS / member.load.tickMs) * GOVERNOR_HEADROOM;
  const catchUpBound = requestedSpeed * CATCH_UP_SHARE;
  const cause: GovernorCause = loadBound < catchUpBound ? 'load' : 'lag';
  return { speed: stepSpeed(Math.min(loadBound, catchUpBound), requestedSpeed), cause };
}

/** Whole steps within the floor and the requested speed; a requested speed under the floor wins. */
function stepSpeed(speed: number, requestedSpeed: number): number {
  const stepsPerSpeed = 1 / GOVERNED_SPEED_STEP;
  const stepped = Math.round(speed * stepsPerSpeed) / stepsPerSpeed;
  return Math.min(requestedSpeed, Math.max(MIN_GOVERNED_SPEED, stepped));
}

/** Both speeds are whole steps, so the rise is counted in whole steps too. */
function withoutSmallRise(speed: number, current: number): number {
  const risenSteps = Math.round((speed - current) / GOVERNED_SPEED_STEP);
  return risenSteps > 0 && risenSteps < GOVERNED_RISE_STEPS ? current : speed;
}
