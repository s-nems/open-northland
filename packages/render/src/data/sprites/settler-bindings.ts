/**
 * The original's `[bobseq]` layout: `dirs` facings laid out back-to-back, each `stride` frames long
 * from {@link start}, drawing `start + facing*stride + (floor(clock / ticksPerFrame) % cycle)` where
 * `cycle` is {@link frames}. The cadence is tick-locked, never stretched to an action's duration (the
 * original's behavior), so a 15-tick chop and a 4-tick deposit advance frames at the same rate.
 * Looping is a property of the driving clock, not the animation: a gait runs on the endless free tick,
 * an action on the atomic's `elapsed`.
 */
export interface DirectionalAnim {
  /** Bob id of direction 0, frame 0 (`startFrame` in `animations.ini`). */
  readonly start: number;
  /** Facing directions laid out back-to-back (Cultures humans use 8). */
  readonly dirs: number;
  /** Frames per direction in the source layout. */
  readonly stride: number;
  /** Frames to actually cycle through (default {@link stride}); `1` holds a single pose per direction. */
  readonly frames?: number;
  /**
   * Sim ticks per animation frame (default `1`). The original's per-`bobseq` frame duration maps here;
   * until it is extracted, `1` is the pinned cadence.
   */
  readonly ticksPerFrame?: number;
  /**
   * Frame within the cycle to start on (default `0`), playing `(phaseStart + step) % cycle`. A
   * `[bobseq]` is a continuous loop with no inherent first frame, so this rotates playback to begin and
   * end on meaningful poses: the chop's 15-frame loop is strike at `0..8` and windup at `9..14`, so
   * `phaseStart: 9` ends a single chop on the impact frame.
   */
  readonly phaseStart?: number;
}

/**
 * The original's `[gfxanimatomic]` `gfxanimframelistdir` binding, for an action whose frames are not a
 * uniform `start + facing*stride` strip. Lists differ per facing and author holds inline (a spear
 * windup repeats its first frame), so a list plays verbatim; a melee swing (pool 102/108/150, not
 * divisible by 8) cannot ride {@link DirectionalAnim} for that reason. One-shot by default, since an
 * authored list is one complete motion and only some lists author a trailing rest pad.
 */
export interface FrameListAnim {
  /** Bob id of the pool's frame 0, which the local {@link frameLists} indices add to. */
  readonly start: number;
  /** Per-facing ordered lists of local frame indices into the pool; outer length = facing directions. */
  readonly frameLists: readonly (readonly number[])[];
  /** Sim ticks per animation frame (default `1`). */
  readonly ticksPerFrame?: number;
  /** Wrap past the last entry instead of returning to the first, for a list driven by the endless free
   *  tick clock (an idle wait cycle), which would otherwise freeze after one play at world start. */
  readonly loop?: boolean;
}

export type SpriteFrameRef = number | DirectionalAnim | FrameListAnim;

/**
 * A settler's frames per coarse sprite state, which the original keys off `tribetypes` `setatomic`.
 * `idle` is the required base that every other slot falls back to.
 */
export interface SettlerStateBinding {
  readonly idle: SpriteFrameRef;
  /** Frames while following a path. Falls back to {@link idle} when absent. */
  readonly moving?: SpriteFrameRef;
  /** Frames while executing any atomic. Falls back to {@link idle}. */
  readonly acting?: SpriteFrameRef;
  /**
   * Per-atomic override for the `acting` state (the `setatomic` join), so chop(24) and pickup(22) draw
   * different animations. A miss falls back to {@link acting}, then {@link idle}.
   */
  readonly byAtomic?: Readonly<Record<number, SpriteFrameRef>>;
  /**
   * The loaded gait in effect while the item hauls a good, the original's `..._walk_wood` bobseq
   * against the plain `..._walk`. Each slot falls back to its un-loaded counterpart. A bound atomic
   * still wins, since a settler only carries after harvesting empty-handed.
   */
  readonly carrying?: CarryingBinding;
  /**
   * The original's `..._walk_agressive` / `..._wait_agressive` bobseqs, played with the weapon readied
   * while the sim marks the unit engaged. Each slot falls back to its un-engaged counterpart, as an
   * unarmed body authors no aggressive variant, and a bound attack atomic still wins mid-swing.
   */
  readonly engaged?: {
    readonly idle?: SpriteFrameRef;
    readonly moving?: SpriteFrameRef;
  };
}

/**
 * The generic hauling look plus an optional per-good table, since the original draws a different carry
 * cycle per hauled good (`human_man_generic_walk_wood`, `_walk_stone`, `_walk_fish`). A good absent
 * from the table falls back to the generic slots, then to the un-loaded ones, so it is always total.
 */
export interface CarryingBinding {
  readonly idle?: SpriteFrameRef;
  readonly moving?: SpriteFrameRef;
  /** Per-`Carrying.goodType` look (the `..._walk_<good>` bobseq join); a miss uses the generic slots. */
  readonly byGood?: Readonly<
    Record<number, { readonly idle?: SpriteFrameRef; readonly moving?: SpriteFrameRef }>
  >;
}

/**
 * Adults and age classes need separate tables: the original's age classes reuse low `jobtypes` ids
 * (1..4 = baby/child), which an adult job id can collide with. The `Age` component disambiguates, since
 * only a born-young settler carries one.
 */
export interface ByJobTable<T> {
  /** Adult looks by `jobType` (e.g. woman 5, the soldier family 31..41). */
  readonly byJob: Readonly<Record<number, T>>;
  /** Looks for an `Age`-carrying (born-young) settler, keyed by its age-class `jobType` (1..4). */
  readonly youngByJob?: Readonly<Record<number, T>>;
  /**
   * A warrior's look by equipped weapon good, since the drawn weapon follows the equipment slot rather
   * than the job. Wins over the job pick; an unmapped weapon falls through to {@link byJob}.
   */
  readonly byWeaponGood?: Readonly<Record<number, T>>;
  /**
   * A weapon-job's bare-hands look, picked when the `Equipment` weapon slot is explicitly empty
   * (`weaponGood` null) so a disarmed swordsman stops drawing its job body's sword. Only weapon-carrying
   * jobs are keyed; a settler with no `Equipment` at all never reaches this table.
   */
  readonly unarmedByJob?: Readonly<Record<number, T>>;
  /** The generic look every unmapped job resolves to. */
  readonly default: T;
}
