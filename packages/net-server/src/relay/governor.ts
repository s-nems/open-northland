import { type GovernedClock, TICK_MS } from '@open-northland/net-protocol';
import type { Member } from './member.js';

/** Wall time a client may trail the clock before the relay paces the room for it: that many frames at
 *  the requested speed. */
export const GOVERN_BEHIND_MS = 2000;
/** A paced-for client is released once it trails by no more than this; lower than `GOVERN_BEHIND_MS`
 *  so a client near the threshold does not flip every advance. */
export const GOVERN_RELEASE_MS = 500;
/** The share of a slow client's sustainable speed the clock runs at, leaving it room to catch up. */
export const GOVERNOR_HEADROOM = 0.8;
/** The floor of a governed clock; a client slower than this is left to the kick vote. */
export const MIN_GOVERNED_SPEED = 0.25;
/** A governed speed is rounded to this, so the relay and the clients run the same announced value and
 *  a jittering load report does not become a clock message per advance. */
export const GOVERNED_SPEED_STEP = 0.05;

/** Frames the clock emits in `ms` of wall time at `speed`, rounded up. */
export function framesIn(ms: number, speed: number): number {
  return Math.ceil((ms / TICK_MS) * speed);
}

/**
 * The speed the clock runs at for the slowest of `slow`, or null when none is slow. A member's
 * sustainable speed is the one that exactly saturates its sim thread; the clock takes the headroom
 * share of it, never above the requested speed nor below `MIN_GOVERNED_SPEED`. Before its first load
 * report a member gets the headroom share of the requested speed. The lowest speed wins; a tie goes to
 * the member furthest behind. A slow member whose share reaches the requested speed governs nothing: it
 * is behind for another reason and its own pacer catches up.
 */
export function governedSpeed(
  slow: Iterable<Member>,
  clockTick: number,
  requestedSpeed: number,
): GovernedClock | null {
  let limiter: { readonly nick: string; readonly speed: number; readonly lag: number } | null = null;
  for (const member of slow) {
    const speed = clampSpeed(memberSpeed(member, requestedSpeed), requestedSpeed);
    const lag = clockTick - member.ackedTick;
    if (limiter === null || speed < limiter.speed || (speed === limiter.speed && lag > limiter.lag))
      limiter = { nick: member.nick, speed, lag };
  }
  if (limiter === null || limiter.speed >= requestedSpeed) return null;
  return { nick: limiter.nick, speed: limiter.speed };
}

function memberSpeed(member: Member, requestedSpeed: number): number {
  if (member.load === null) return requestedSpeed * GOVERNOR_HEADROOM;
  return (TICK_MS / member.load.tickMs) * GOVERNOR_HEADROOM;
}

function clampSpeed(speed: number, requestedSpeed: number): number {
  const stepsPerSpeed = 1 / GOVERNED_SPEED_STEP;
  const rounded = Math.round(speed * stepsPerSpeed) / stepsPerSpeed;
  return Math.min(requestedSpeed, Math.max(MIN_GOVERNED_SPEED, rounded));
}
