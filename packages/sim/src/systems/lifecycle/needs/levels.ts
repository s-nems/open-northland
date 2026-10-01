import {
  type NeedDrain,
  type NeedKind,
  type NeedLevels,
  SettlerNeeds,
  type SettlerNeedsState,
  type SettlerNeedsView,
} from '../../../components/index.js';
import { type Fixed, fx, ONE, ZERO } from '../../../core/fixed.js';
import type { Entity, World } from '../../../ecs/world.js';
import {
  NEED_CRITICAL_THRESHOLD,
  NEED_DRAIN_UNITS_PER_TICK,
  NEED_DRIVE_THRESHOLD,
  NEED_SATED_THRESHOLD,
  needBar,
} from './scale.js';

// A draining bar is stored as its level at `asOf` and derived on read: n drain passes later it reads
// min(ONE, level + n * DRAIN_RISE), exactly what n clamped one-step drains produce, since the rise is
// positive and a stored bar never exceeds ONE.
//
// Every read and write names the tick the drain has run through: `ctx.tick` in a system after the needs
// pass, `ctx.tick - 1` in one before it (the command system), the snapshot's tick outside the sim.

/** The deficit one drain pass adds: {@link NEED_DRAIN_UNITS_PER_TICK} reserve units off the bar. */
const DRAIN_RISE: Fixed = fx.sub(ZERO, needBar(-NEED_DRAIN_UNITS_PER_TICK));

/**
 * The levels the needs pass rewrites a draining bar at when it rises to them, so a stored bar always sits
 * on the same side of each as the bar it derives to. A reader without the tick, such as a snapshot index
 * predicate, may compare the stored bar against these.
 */
export const NEED_BAND_THRESHOLDS: readonly Fixed[] = [
  NEED_SATED_THRESHOLD,
  NEED_DRIVE_THRESHOLD,
  NEED_CRITICAL_THRESHOLD,
  ONE,
];

function drains(drain: NeedDrain, need: NeedKind): boolean {
  if (drain === 'none' || need === 'piety') return false;
  return drain === 'all' || need !== 'enjoyment';
}

/** `need`'s bar once the drain pass of tick `drainedThrough` has run. A read before the stored tick sees
 *  the stored bar. */
export function needLevel(needs: SettlerNeedsView, need: NeedKind, drainedThrough: number): Fixed {
  const stored = needs[need];
  const passes = drainedThrough - needs.asOf;
  if (passes <= 0 || !drains(needs.drain, need)) return stored;
  const risen = fx.add(stored, fx.mulInt(DRAIN_RISE, passes));
  return risen > ONE ? ONE : risen;
}

/** All four bars at `drainedThrough`, for a reader that shows them together. */
export function needLevels(needs: SettlerNeedsView, drainedThrough: number): NeedLevels {
  return {
    hunger: needLevel(needs, 'hunger', drainedThrough),
    fatigue: needLevel(needs, 'fatigue', drainedThrough),
    piety: needs.piety,
    enjoyment: needLevel(needs, 'enjoyment', drainedThrough),
  };
}

/** Store the bars as they stand at `drainedThrough` in a component already acquired for writing. */
export function rebaseNeeds(s: SettlerNeedsState, drainedThrough: number): void {
  if (drainedThrough <= s.asOf) return;
  s.hunger = needLevel(s, 'hunger', drainedThrough);
  s.fatigue = needLevel(s, 'fatigue', drainedThrough);
  s.enjoyment = needLevel(s, 'enjoyment', drainedThrough);
  s.asOf = drainedThrough;
}

/** Acquire `e`'s bars for writing, stored as they stand at `drainedThrough`, so a field read or written
 *  through the result is the current bar. */
export function mutNeeds(world: World, e: Entity, drainedThrough: number): SettlerNeedsState {
  const s = world.mut(e, SettlerNeeds);
  rebaseNeeds(s, drainedThrough);
  return s;
}

/** Whether the drain pass of `tick` raises one of the bars onto a {@link NEED_BAND_THRESHOLDS} level. */
export function drainReachesBand(needs: SettlerNeedsView, tick: number): boolean {
  const passes = tick - needs.asOf;
  if (passes <= 0 || needs.drain === 'none') return false;
  const risenBefore = fx.mulInt(DRAIN_RISE, passes - 1);
  return (
    risesOntoBand(needs.hunger, risenBefore) ||
    risesOntoBand(needs.fatigue, risenBefore) ||
    (needs.drain === 'all' && risesOntoBand(needs.enjoyment, risenBefore))
  );
}

/** Whether one more pass raises a bar stored at `stored`, already risen by `risenBefore`, onto a band
 *  threshold. Every threshold is at most ONE, so the unclamped rise compares the same as the clamped. */
function risesOntoBand(stored: Fixed, risenBefore: Fixed): boolean {
  const from = fx.add(stored, risenBefore);
  if (from >= ONE) return false;
  const to = fx.add(from, DRAIN_RISE);
  for (const threshold of NEED_BAND_THRESHOLDS) {
    if (from < threshold && to >= threshold) return true;
  }
  return false;
}
