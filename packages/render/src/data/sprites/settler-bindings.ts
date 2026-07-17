/**
 * Settler binding-table types: which atlas bob a settler draws per state, per facing, per
 * hauled/engaged variant, and per job. Content fills these from the extracted IR; the pure
 * {@link import('./settler.js')} resolver consumes them. The layered building/resource/stockpile
 * binding types live in {@link import('./layered-bindings.js')};
 * {@link import('./bindings.js').SpriteBindings} composes both.
 */

/**
 * A directional, time-animated bob sequence — the original's `[bobseq]` layout: `dirs` facing
 * directions laid out back-to-back, each `stride` frames long, starting at bob id {@link start}. The
 * frame to draw is `start + facing*stride + (floor(clock / ticksPerFrame) % cycle)`, where `cycle` is
 * {@link frames} (default {@link stride}). The cadence is locked to sim ticks, never stretched to fit
 * an action's duration (the original's behavior): a 15-tick chop and a 4-tick deposit advance frames
 * at the identical rate. `frames: 1` holds a single still pose per direction. The facing index comes
 * from {@link import('../scene/index.js').DrawItem.facing} (else
 * {@link import('./settler.js').DEFAULT_FACING}).
 *
 * Looping vs one-shot is not a property of the animation but of which clock
 * {@link import('./settler.js').resolveSettlerBobId} drives it by: a gait (walk) runs on the free
 * `tick` clock (an endless loop), an action (chop) runs on the atomic's own `elapsed` clock and, because
 * the action's `duration` is tuned to a whole number of cycles, plays exactly that many full swings and
 * ends as the action completes.
 */
export interface DirectionalAnim {
  /** Bob id of direction 0, frame 0 — the sequence's first frame (`startFrame` in `animations.ini`). */
  readonly start: number;
  /** Number of facing directions laid out back-to-back (Cultures humans use 8). */
  readonly dirs: number;
  /** Frames per direction in the source layout — the stride between one direction and the next. */
  readonly stride: number;
  /** Frames to actually cycle through (default {@link stride}); `1` holds a single pose per direction. */
  readonly frames?: number;
  /**
   * Sim ticks per animation frame (default `1`, one frame per tick). Larger values hold each frame for
   * several ticks while keeping the sequence tick-locked and constant-speed. The original's
   * per-`bobseq` frame duration maps here; until it is extracted, `1` is the pinned cadence.
   */
  readonly ticksPerFrame?: number;
  /**
   * Frame index within the cycle to start on (default `0`) — the sequence plays
   * `(phaseStart + step) % cycle`. A `[bobseq]` is a continuous loop with no inherent first frame, so
   * this rotates where playback begins, letting an action begin and end on meaningful poses. The chop's
   * 15-frame loop is `0..8` = the axe coming down to the tree (the strike) and `9..14` = the axe rising
   * (the windup); `phaseStart: 9` plays windup→strike (9..14, 0..8) so a single chop starts by winding
   * up and ends on the impact (frame 8). A gait (walk) starts at 0.
   */
  readonly phaseStart?: number;
}

/**
 * A directional animation laid out as explicit per-facing frame-index lists — the original's
 * `[gfxanimatomic]` `gfxanimframelistdir` binding (extracted as
 * {@link import('@open-northland/data').GfxAnimAtomic}), for an action whose frames are not a uniform
 * `start + facing*stride` strip. Each {@link frameLists} entry is one facing's ordered list of local
 * frame indices into a bobseq pool starting at {@link start} (drawn bob id = `start + frameLists[dir][i]`).
 * The lists differ per facing and author holds/repeats inline (a spear windup repeats its first frame),
 * so playback plays a list verbatim — the reason a melee swing (pool 102/108/150, not divisible by 8)
 * cannot ride {@link DirectionalAnim}. The facing index selects the list ({@link frameLists} length =
 * directions; a length-1 list is facing-locked). Advances one entry every {@link ticksPerFrame} ticks
 * on the driving clock (an action's `elapsed`), the same tick-locked cadence {@link DirectionalAnim}
 * uses, but one-shot: past the last entry the sprite shows the first entry, the ready stance, instead
 * of wrapping (an authored list is one complete motion, and only some lists author a trailing rest pad).
 */
export interface FrameListAnim {
  /** Bob id of the pool's frame 0 — the bobseq `start` the local {@link frameLists} indices add to. */
  readonly start: number;
  /** Per-facing ordered lists of local frame indices into the pool; outer length = facing directions. */
  readonly frameLists: readonly (readonly number[])[];
  /** Sim ticks per animation frame — the fixed cadence (default `1`), like {@link DirectionalAnim.ticksPerFrame}. */
  readonly ticksPerFrame?: number;
}

/** A frame reference in a settler binding: a fixed bob id, a uniform {@link DirectionalAnim}, or an
 *  explicit per-facing {@link FrameListAnim} (the `[gfxanimatomic]` directional action layout). */
export type SpriteFrameRef = number | DirectionalAnim | FrameListAnim;

/**
 * A settler's per-state frames — which atlas bob to draw for each coarse
 * {@link import('../scene/index.js').SpriteState}. The original keys these off `tribetypes`
 * `setatomic` (atomic → animation). `idle` is the required base; `moving`/`acting` are optional and
 * fall back to `idle` when absent, and an `acting` settler can bind a specific atomic id via
 * {@link SettlerStateBinding.byAtomic} (so chop vs carry pick different frames), with `acting` as the
 * generic-action fallback when an atomic isn't listed.
 */
export interface SettlerStateBinding {
  /** Required base frame — used when no more-specific state frame is bound. */
  readonly idle: SpriteFrameRef;
  /** Frame(s) while following a path. Falls back to {@link idle} when absent. */
  readonly moving?: SpriteFrameRef;
  /** Frame(s) while executing any atomic (the generic action). Falls back to {@link idle}. */
  readonly acting?: SpriteFrameRef;
  /**
   * Per-atomic-id override for the `acting` state (the `setatomic` join: atomic id → its frame(s)), so
   * e.g. chop(24) and pickup(22) draw different animations. A miss falls back to {@link acting} then
   * {@link idle}.
   */
  readonly byAtomic?: Readonly<Record<number, SpriteFrameRef>>;
  /**
   * Loaded-gait override, in effect only while the draw item is hauling a good
   * ({@link import('../scene/index.js').DrawItem.carrying}) — the original's `..._walk_wood` bobseq vs
   * the plain `..._walk`: `moving` while walking a load home, `idle` while standing or depositing it.
   * Each slot falls back to its un-loaded counterpart when absent. A bound atomic animation (e.g. the
   * chop in {@link byAtomic}) still wins, since a settler only carries after it has finished harvesting
   * empty-handed.
   */
  readonly carrying?: CarryingBinding;
  /**
   * Combat-engaged gait override — the original's `..._walk_agressive` / `..._wait_agressive` bobseqs a
   * soldier plays while advancing on or standing off against an enemy (its weapon readied), distinct
   * from the relaxed economy walk/wait. In effect only while the draw item is
   * {@link import('../scene/index.js').DrawItem.engaged} (the sim `Engagement` marker): `moving` swaps the
   * approach walk, `idle` the ready stance. Each slot falls back to its un-engaged counterpart when absent
   * (the unarmed body authors no aggressive variant). A bound atomic (the attack swing in
   * {@link byAtomic}) still wins while the unit is mid-swing.
   */
  readonly engaged?: {
    readonly idle?: SpriteFrameRef;
    readonly moving?: SpriteFrameRef;
  };
}

/**
 * The loaded-gait slots of a {@link SettlerStateBinding}: the generic hauling look (`idle`/`moving`)
 * plus an optional per-good table. The original draws a different carry cycle per hauled good
 * (`human_man_generic_walk_wood` for a log, `_walk_stone`, `_walk_fish`, …); {@link byGood} keys those
 * on the sim's `Carrying.goodType` ({@link import('../scene/index.js').DrawItem.carryGood}). A good
 * absent from the table falls back to the generic `idle`/`moving` slots, then to the un-loaded
 * counterparts, so a sparse table is always total.
 */
export interface CarryingBinding {
  readonly idle?: SpriteFrameRef;
  readonly moving?: SpriteFrameRef;
  /** Per-`goodType` hauling look (the `..._walk_<good>` bobseq join); a miss uses the generic slots. */
  readonly byGood?: Readonly<
    Record<number, { readonly idle?: SpriteFrameRef; readonly moving?: SpriteFrameRef }>
  >;
}

/**
 * A job-keyed lookup with a young (age-class) side table and a total fallback — the shape the
 * per-character settler binding uses ({@link import('../../gpu/sprite-sheet.js').SettlerCharacterSet}), kept
 * generic and pure here so the pick is unit-testable without GPU layers.
 *
 * Two tables because the original's age classes reuse low `jobtypes` ids (1..4 = baby/child) and a
 * synthetic fixture's adult job ids can collide with them (the demo woodcutter is jobType 1 — the real
 * `baby_female` id; see AGENTS.md [dc3ef54]). The sim disambiguates by the `Age` component (only a
 * born-young settler carries one), so the pick does too: a young item keys
 * {@link ByJobTable.youngByJob}, an adult keys {@link ByJobTable.byJob}, and any miss (including a
 * `null`-job idle adult) lands on {@link ByJobTable.default}.
 */
export interface ByJobTable<T> {
  /** Adult looks by `jobType` (e.g. woman 5, the soldier family 31..41). */
  readonly byJob: Readonly<Record<number, T>>;
  /** Looks for an `Age`-carrying (born-young) settler, keyed by its age-class `jobType` (1..4). */
  readonly youngByJob?: Readonly<Record<number, T>>;
  /**
   * A warrior's look by its equipped weapon good — the drawn weapon follows the equipment weapon slot,
   * not the job. Wins over the job pick when the settler carries a mapped weapon good; an empty or
   * unmapped slot falls through to {@link byJob} (so a bare warrior draws its job body, a civilian its
   * civilian body).
   */
  readonly byWeaponGood?: Readonly<Record<number, T>>;
  /** The total fallback — the generic look every unmapped job resolves to. */
  readonly default: T;
}
