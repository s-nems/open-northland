import type { DrawItem, SpriteState } from '../scene/index.js';
import type { ByJobTable, SettlerStateBinding, SpriteFrameRef } from './settler-bindings.js';

/**
 * The facing for an item with no heading to derive one from. `5` is SE on screen in the `CR_Hum_Body`
 * direction layout (`0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S, 7 N`), a toward-camera pose rather than a
 * back view. Approximation: there is no per-entity hold-the-last-heading yet.
 */
export const DEFAULT_FACING = 5;

/** Non-negative modulo (JS `%` keeps the sign), so a negative facing/tick still indexes in range. */
function wrap(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** `clock` is an integer tick count: the free sim tick for a gait, the atomic's `elapsed` for an action. */
function frameOf(ref: SpriteFrameRef, facing: number, clock: number): number {
  if (typeof ref === 'number') return ref;
  const ticksPerFrame = Math.max(1, ref.ticksPerFrame ?? 1);
  const step = Math.floor(clock / ticksPerFrame);
  // A frame list draws pool start + its facing list's entry at the step; an absent list holds frame 0.
  if ('frameLists' in ref) {
    const lists = ref.frameLists;
    if (lists.length === 0) return ref.start;
    const list = lists[wrap(facing, lists.length)];
    if (list === undefined || list.length === 0) return ref.start;
    // Past the list's end the sprite returns to the first entry, the tool-ready stance every list
    // opens on: the stonecrush and shovel lists end mid-motion, and holding their last entry leaves
    // the digger frozen in half a swing.
    const idx = ref.loop === true ? wrap(step, list.length) : step < list.length ? step : 0;
    return ref.start + (list[idx] ?? 0);
  }
  const dir = wrap(facing, ref.dirs);
  const cycle = ref.frames ?? ref.stride;
  if (cycle <= 0) return ref.start + dir * ref.stride;
  const phase = wrap((ref.phaseStart ?? 0) + step, cycle);
  return ref.start + dir * ref.stride + phase;
}

/**
 * The state pick runs a fixed fallback chain so a sparse table is always total: `acting` tries
 * `byAtomic[id]`, then `acting`, then `idle`; `moving` tries `moving`, then `idle`. The engaged and
 * carrying overrides take precedence for the `moving`/`idle` slots, in that order.
 */
export function resolveSettlerBobId(
  binding: number | SettlerStateBinding,
  item: DrawItem,
  tick: number,
  // The moving-state clock, where the pool passes a motion-scaled walk-cycle phase so feet track
  // ground covered rather than wall ticks. Defaults to the free tick, the fixed cadence every other
  // caller wants.
  gaitClock: number = tick,
): number {
  if (typeof binding === 'number') return binding;
  const facing = item.facing ?? DEFAULT_FACING;
  const state: SpriteState = item.state ?? 'idle';
  const carrying = item.carrying ? binding.carrying : undefined;
  const byGood = item.carryGood !== undefined ? carrying?.byGood?.[item.carryGood] : undefined;
  const carry =
    carrying === undefined
      ? undefined
      : { idle: byGood?.idle ?? carrying.idle, moving: byGood?.moving ?? carrying.moving };
  // The engaged gait wins over the loaded one below: an engaged soldier is fighting, not hauling.
  const engaged = item.engaged ? binding.engaged : undefined;
  if (state === 'acting') {
    // An action runs on the atomic's own clock, rebased to 0 so frame 0 shows on its first tick.
    const clock = Math.max(0, (item.elapsed ?? 1) - 1);
    const byAtomic = binding.byAtomic;
    if (byAtomic !== undefined && item.atomicId !== undefined) {
      const specific = byAtomic[item.atomicId];
      if (specific !== undefined) return frameOf(specific, facing, clock);
    }
    // An atomic with no bound animation stands still: a deposit has no decoded swing, and standing
    // never borrows the woodcut swing at a wrong speed.
    return frameOf(engaged?.idle ?? carry?.idle ?? binding.acting ?? binding.idle, facing, clock);
  }
  if (state === 'moving') {
    // The walk cycle runs on the gait clock; the idle loop below stays on the free tick, so a standing
    // unit keeps breathing.
    return frameOf(engaged?.moving ?? carry?.moving ?? binding.moving ?? binding.idle, facing, gaitClock);
  }
  return frameOf(engaged?.idle ?? carry?.idle ?? binding.idle, facing, tick);
}

/**
 * Precedence for an adult: a mapped weapon good, then an explicitly empty weapon slot's bare-hands
 * look, then the job. A young item keys the age-class table, and any miss lands on `default`.
 */
export function pickByJob<T>(
  table: ByJobTable<T>,
  jobType: number | undefined,
  young: boolean,
  weaponGood?: number | null,
): T {
  // Children never carry a weapon slot, so the equipped weapon only decides an adult's look.
  if (!young && weaponGood != null) {
    const armed = table.byWeaponGood?.[weaponGood];
    if (armed !== undefined) return armed;
  }
  if (jobType === undefined) return table.default;
  if (!young && weaponGood === null) {
    const bare = table.unarmedByJob?.[jobType];
    if (bare !== undefined) return bare;
  }
  const hit = young ? table.youngByJob?.[jobType] : table.byJob[jobType];
  return hit ?? table.default;
}
