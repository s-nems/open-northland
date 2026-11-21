/**
 * A count of whole worked ticks that writes nothing while it runs. Stopped, `elapsed` holds it; running,
 * `startedAt` anchors it and `elapsed` is 0. The system that owns the clock starts it on the first tick
 * it works and stops it on the first tick it does not.
 */
export interface WorkClock {
  elapsed: number;
  startedAt?: number | undefined;
}

/** The worked ticks at a settled snapshot of `tick`, or within `tick` once the owning system has run; a
 *  reader ahead of that system in the schedule passes the previous tick. */
export function workClockTicks(clock: Readonly<WorkClock>, tick: number): number {
  return clock.startedAt === undefined ? clock.elapsed : tick - clock.startedAt;
}

/** Start a stopped clock with `tick` as its next worked tick. */
export function startWorkClock(clock: WorkClock, tick: number): void {
  clock.startedAt = tick - clock.elapsed - 1;
  clock.elapsed = 0;
}

/** Stop a running clock on `tick`, the first tick it is not worked. */
export function stopWorkClock(clock: WorkClock, tick: number): void {
  if (clock.startedAt === undefined) return;
  clock.elapsed = tick - 1 - clock.startedAt;
  clock.startedAt = undefined;
}
