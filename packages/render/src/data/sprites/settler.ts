import type { DrawItem, SpriteState } from '../scene/index.js';
import type { ByJobTable, SettlerStateBinding, SpriteFrameRef } from './settler-bindings.js';

/**
 * The facing for an item carrying no heading. Approximation: `5` is SE on screen in the `CR_Hum_Body`
 * direction layout, chosen as a toward-camera pose rather than a back view. The pool's held last heading
 * only covers a `moving`-state gap, so any other item without `facing` lands here.
 */
export const DEFAULT_FACING = 5;

/**
 * The source's `<dir>` index (`gfxanimframelistdir`, `gfxinhousewalk`, `gfxinhouseanim`) → the render
 * facing. The `CR_Hum_Body` strip-block order is `0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S, 7 N` (source
 * basis "Settler facing"); the source's `<dir>` space is the engine's movement-direction ring, `0 E,
 * 1 SE, 2 SW, 3 W, 4 NW, 5 NE` plus the row-crossing verticals `6 N, 7 S`. Data-pinned twice: in every
 * extracted human-body `[gfxanimatomic]` record with a uniform ×8 strip, each dir-`d` frame list indexes
 * exclusively into strip block `GFX_DIR_TO_FACING[d]`; and each in-house walk's own pixel delta runs the
 * way its `<dir>` names. The animal tables ride the same remap by analogy.
 */
export const GFX_DIR_TO_FACING = [4, 5, 0, 1, 2, 3, 7, 6] as const;

/** {@link GFX_DIR_TO_FACING} as a total function; an out-of-range dir keeps {@link DEFAULT_FACING}. */
export function gfxDirToFacing(dir: number): number {
  return GFX_DIR_TO_FACING[dir] ?? DEFAULT_FACING;
}

/** Non-negative modulo (JS `%` keeps the sign), so a negative facing/tick still indexes in range. */
function wrap(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function heldStep(holds: readonly number[], time: number): number {
  for (const [index, duration] of holds.entries()) {
    if (time < duration) return index;
    time -= duration;
  }
  return Math.max(0, holds.length - 1);
}

/** Subtick clips accept a fractional presentation clock; original bindings retain integer cadence. */
function frameOf(ref: SpriteFrameRef, facing: number, clock: number): number {
  if (typeof ref === 'number') return ref;
  const minimum = 'subtick' in ref && ref.subtick === true ? Number.EPSILON : 1;
  const ticksPerFrame = Math.max(minimum, ref.ticksPerFrame ?? 1);
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
  if (ref.frameDurations !== undefined && ref.frameDurations.length > 0) {
    const total = ref.frameDurations.reduce((sum, duration) => sum + duration, 0);
    const index = heldStep(ref.frameDurations, wrap(clock, total));
    return ref.start + dir * ref.stride + (ref.frameOrder?.[index] ?? index);
  }
  const cycle = ref.frames ?? ref.stride;
  if (cycle <= 0) return ref.start + dir * ref.stride;
  const phase = wrap((ref.phaseStart ?? 0) + step, cycle);
  return ref.start + dir * ref.stride + phase;
}

/** The `bySubClip` key of one in-house sub-clip; `subId` 0 names the job's own record for the action. */
export function subClipKey(action: number, subId: number): string {
  return `${action}/${subId}`;
}

/**
 * The frame of a clip stretched over a window: `progress` runs 0..1 across the whole clip rather than one
 * frame per tick, so one play fills the window whatever its length, and the last frame holds at the end
 * instead of wrapping. Approximation: the authored clip lengths and window lengths agree on no cadence,
 * so the data does not settle the engine's own rule.
 */
function stretchedFrame(ref: SpriteFrameRef, facing: number, progress: number): number {
  if (typeof ref === 'number') return ref;
  const at = (count: number): number => Math.min(count - 1, Math.max(0, Math.floor(progress * count)));
  if ('frameLists' in ref) {
    const lists = ref.frameLists;
    if (lists.length === 0) return ref.start;
    const list = lists[wrap(facing, lists.length)];
    if (list === undefined || list.length === 0) return ref.start;
    return ref.start + (list[at(list.length)] ?? 0);
  }
  const dir = wrap(facing, ref.dirs);
  if (ref.frameDurations?.length) {
    const total = ref.frameDurations.reduce((sum, hold) => sum + hold, 0);
    const index = heldStep(ref.frameDurations, Math.max(0, Math.min(1, progress)) * total);
    return ref.start + dir * ref.stride + (ref.frameOrder?.[index] ?? index);
  }
  const cycle = ref.frames ?? ref.stride;
  if (cycle <= 0) return ref.start + dir * ref.stride;
  return ref.start + dir * ref.stride + at(cycle);
}

export function movingFrameRef(binding: SettlerStateBinding, item: DrawItem): SpriteFrameRef {
  const carry = item.carrying ? binding.carrying : undefined;
  const loaded = item.carryGood === undefined ? undefined : carry?.byGood?.[item.carryGood];
  return (
    (item.engaged ? binding.engaged?.moving : undefined) ??
    loaded?.moving ??
    carry?.moving ??
    binding.moving ??
    binding.idle
  );
}

/** The state pick runs a fixed fallback chain so a sparse table is always total. */
export function resolveSettlerBobId(
  binding: number | SettlerStateBinding,
  item: DrawItem,
  tick: number,
  // The moving-state clock. Defaults to the free tick, for a caller with no motion track.
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
  const engaged = item.engaged ? binding.engaged : undefined;
  if (state === 'acting') {
    // An in-house program names its own clip and drives it by window progress, not by the atomic clock.
    const craft = item.craftClip;
    if (craft !== undefined) {
      const ref =
        binding.bySubClip?.[subClipKey(craft.action, craft.subId)] ??
        (craft.subId === 0 ? binding.byAtomic?.[craft.action] : undefined);
      if (ref === undefined) return frameOf(binding.idle, facing, tick); // an unbound clip just stands
      return stretchedFrame(ref, facing, craft.progress);
    }
    // An action runs on the atomic's own clock, rebased to 0 so frame 0 shows on its first tick.
    const clock = Math.max(0, (item.elapsed ?? 1) - 1);
    const byAtomic = binding.byAtomic;
    if (byAtomic !== undefined && item.atomicId !== undefined) {
      const specific = byAtomic[item.atomicId];
      // A rest tail keeps the tool-ready pose instead of starting a partial extra swing.
      if (specific !== undefined) return frameOf(specific, facing, item.atomicRest === true ? 0 : clock);
    }
    // With no generic `acting` bound the atomic stands still, rather than borrowing the woodcut swing
    // at a wrong speed.
    const ref = engaged?.idle ?? carry?.idle ?? binding.acting ?? binding.idle;
    const smoothIdle =
      ref === binding.idle && typeof ref !== 'number' && 'subtick' in ref && ref.subtick === true;
    return frameOf(ref, facing, smoothIdle ? tick : clock);
  }
  if (state === 'moving') {
    return frameOf(movingFrameRef(binding, item), facing, gaitClock);
  }
  return frameOf(engaged?.idle ?? carry?.idle ?? binding.idle, facing, tick);
}

/**
 * Precedence for an adult: a fixed authored job, a mapped weapon good, then an explicitly empty weapon
 * slot's bare-hands look, then the job. A young item keys the age-class table, and any miss lands on
 * `default`.
 */
export function pickByJob<T>(
  table: ByJobTable<T>,
  jobType: number | undefined,
  young: boolean,
  weaponGood?: number | null,
): T {
  if (!young && jobType !== undefined) {
    const fixed = table.fixedByJob?.[jobType];
    if (fixed !== undefined) return fixed;
  }
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
