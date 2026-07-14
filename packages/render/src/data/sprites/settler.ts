import type { DrawItem, SpriteState } from '../scene/index.js';
import type { ByJobTable, SettlerStateBinding, SpriteFrameRef } from './settler-bindings.js';

/**
 * The settler frame-selection state machine: which bob id a settler draws for its state + facing +
 * animation clock. Pure functions of the draw item + its binding (see test/sprites.test.ts).
 */

/**
 * The facing used when a draw item carries none (`item.facing` is undefined — an idle/acting settler
 * with no live movement to derive a heading from). `5` is SE on screen (toward the camera-right) in the
 * `CR_Hum_Body` direction layout (`0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S, 7 N`; source basis "Settler
 * facing"), a toward-camera pose rather than a back/profile view. Approximation: no per-entity "hold
 * the last heading" yet.
 */
export const DEFAULT_FACING = 5;

/** Non-negative modulo (JS `%` keeps the sign), so a negative facing/tick still indexes in range. */
function wrap(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * Resolve a {@link SpriteFrameRef} to a concrete bob id for a given facing and animation `clock` (an
 * integer tick count — the free sim tick for a looping gait, or the atomic's `elapsed` for an action).
 * A plain number is that id verbatim; a {@link import('./bindings.js').DirectionalAnim} or
 * {@link import('./bindings.js').FrameListAnim} resolves through the layout, cadence and `phaseStart`
 * semantics documented on its type in settler-bindings.ts.
 */
function frameOf(ref: SpriteFrameRef, facing: number, clock: number): number {
  if (typeof ref === 'number') return ref;
  const ticksPerFrame = Math.max(1, ref.ticksPerFrame ?? 1);
  const step = Math.floor(clock / ticksPerFrame);
  // A FrameListAnim (the `[gfxanimatomic]` directional action layout) selects its facing's explicit
  // list and plays it once: draw id = pool start + the local entry at the clamped step. An
  // empty/absent list holds frame 0.
  if ('frameLists' in ref) {
    const lists = ref.frameLists;
    if (lists.length === 0) return ref.start;
    const list = lists[wrap(facing, lists.length)];
    if (list === undefined || list.length === 0) return ref.start;
    // Past the list's end the sprite returns to the first entry — the tool-ready stance on every list —
    // instead of wrapping into a replay: the stonecrush/shovel lists end mid-motion, so holding the last
    // entry froze the digger in half a swing, and a duration longer than its list (the mushroom pluck)
    // would stutter back through the motion.
    const idx = step < list.length ? step : 0;
    return ref.start + (list[idx] ?? 0);
  }
  const dir = wrap(facing, ref.dirs);
  const cycle = ref.frames ?? ref.stride;
  if (cycle <= 0) return ref.start + dir * ref.stride;
  const phase = wrap((ref.phaseStart ?? 0) + step, cycle);
  return ref.start + dir * ref.stride + phase;
}

/**
 * Resolve the settler bob id for a draw item's {@link SpriteState} + facing + tick, given its
 * (number | table) binding. A plain number is the same frame for every state. A
 * {@link SettlerStateBinding} picks by state with a fixed fallback chain so a sparse table is always
 * total: `acting` tries `byAtomic[id]` → `acting` → `idle`; `moving` tries `moving` → `idle`; `idle` is
 * `idle`. When the item is {@link DrawItem.carrying} a good, the {@link SettlerStateBinding.carrying}
 * loaded-gait override is consulted first for the `moving`/`idle` slots — the hauled good's own
 * {@link import('./bindings.js').CarryingBinding.byGood} look when bound ({@link DrawItem.carryGood}),
 * else the generic loaded slots — so a hauling settler walks the loaded cycle; a bound atomic still
 * wins, as a settler only carries after harvesting empty-handed. The chosen {@link SpriteFrameRef} is
 * then resolved through {@link frameOf}. Exported so the per-character render path
 * ({@link import('../../gpu/sprite-sheet.js').SettlerCharacter}) resolves its own binding through the
 * same state machine the single-binding path uses.
 */
export function resolveSettlerBobId(
  binding: number | SettlerStateBinding,
  item: DrawItem,
  tick: number,
  // The moving-state clock: the pool passes its motion-scaled walk-cycle phase (feet track ground
  // covered, not wall ticks — gpu/sprite-pool/motion.ts `gaitPhase`); defaults to the free tick so
  // every other caller (ghost previews, the synthetic sheet, tests) keeps the fixed cadence.
  gaitClock: number = tick,
): number {
  if (typeof binding === 'number') return binding;
  const facing = item.facing ?? DEFAULT_FACING;
  const state: SpriteState = item.state ?? 'idle';
  // Loaded-gait overrides, in effect only while the settler is hauling a good: the good's own look
  // first (the per-good `walk_<good>` join), then the generic loaded slots.
  const carrying = item.carrying ? binding.carrying : undefined;
  const byGood = item.carryGood !== undefined ? carrying?.byGood?.[item.carryGood] : undefined;
  const carry =
    carrying === undefined
      ? undefined
      : { idle: byGood?.idle ?? carrying.idle, moving: byGood?.moving ?? carrying.moving };
  // Combat-engaged gait override (the `..._agressive` walk/wait), in effect only while the sim marks the
  // unit engaged. Wins over the loaded gait — an engaged soldier is fighting, not hauling — and falls
  // back to its un-engaged counterpart when a slot is unbound (the unarmed body authors no aggressive
  // variant). A bound attack swing (byAtomic) still wins below while the unit is mid-swing.
  const engaged = item.engaged ? binding.engaged : undefined;
  if (state === 'acting') {
    // An action animation runs on the atomic's own clock: `elapsed` ticks since the action started
    // (0-based, so frame 0 shows on its first tick), advancing at the binding's tick-locked cadence.
    const clock = Math.max(0, (item.elapsed ?? 1) - 1);
    const byAtomic = binding.byAtomic;
    if (byAtomic !== undefined && item.atomicId !== undefined) {
      const specific = byAtomic[item.atomicId];
      if (specific !== undefined) return frameOf(specific, facing, clock);
    }
    // No animation bound for this atomic → a still pose: the engaged/loaded stand, else the generic
    // acting/idle. A deposit/pickup has no decoded swing; standing is faithful-enough and never borrows
    // the woodcut swing at a wrong speed.
    return frameOf(engaged?.idle ?? carry?.idle ?? binding.acting ?? binding.idle, facing, clock);
  }
  if (state === 'moving') {
    // The walk cycle runs on the gait clock — motion-scaled by the pool — so a braking, accelerating
    // or body-pressed walker's legs slow with its actual advance instead of jogging in place. The
    // idle 'wait' loop below stays on the free tick (a standing unit keeps breathing).
    return frameOf(engaged?.moving ?? carry?.moving ?? binding.moving ?? binding.idle, facing, gaitClock);
  }
  return frameOf(engaged?.idle ?? carry?.idle ?? binding.idle, facing, tick);
}

/**
 * Pick from a {@link ByJobTable} for a draw item's `jobType`, `young` flag and equipped `weaponGood`.
 * An adult carrying a mapped weapon good takes {@link ByJobTable.byWeaponGood} first — the drawn weapon
 * follows the equipment slot, not the job. Otherwise: young → {@link ByJobTable.youngByJob}, adult →
 * {@link ByJobTable.byJob}, any miss → {@link ByJobTable.default}.
 */
export function pickByJob<T>(
  table: ByJobTable<T>,
  jobType: number | undefined,
  young: boolean,
  weaponGood?: number,
): T {
  // The equipped weapon decides an adult warrior's look; children never carry a weapon slot.
  if (!young && weaponGood !== undefined) {
    const armed = table.byWeaponGood?.[weaponGood];
    if (armed !== undefined) return armed;
  }
  if (jobType === undefined) return table.default;
  const hit = young ? table.youngByJob?.[jobType] : table.byJob[jobType];
  return hit ?? table.default;
}
