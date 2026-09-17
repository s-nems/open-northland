/**
 * The original's `[bobseq]` layout: `dirs` facings laid out back-to-back, each `stride` frames long
 * from {@link start}, drawing `start + facing*stride + (floor(clock / ticksPerFrame) % cycle)` where
 * `cycle` is {@link frames}. Original bindings keep tick cadence; authored clips can opt into subticks.
 */
export interface DirectionalAnim {
  /** Authored high-rate clips can advance between simulation ticks. */
  readonly subtick?: boolean;
  /** Projected atlas pixels covered per complete walk cycle, in facing order. */
  readonly travelPerCycle?: readonly number[];
  /** Positive hold durations in tick units, one per stored pose; their sum is the loop duration. */
  readonly frameDurations?: readonly number[];
  /** Stored pose indices in playback order; repeated entries reuse the same texture cell. */
  readonly frameOrder?: readonly number[];
  /** Bob id of direction 0, frame 0 - the `[bobseq]` `seq` record's start value. */
  readonly start: number;
  /** Facing directions laid out back-to-back. */
  readonly dirs: number;
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
   * end on meaningful poses.
   */
  readonly phaseStart?: number;
}

/**
 * The original's `[gfxanimatomic]` `gfxanimframelistdir` binding, for an action whose frames are not a
 * uniform `start + facing*stride` strip: lists differ per facing and author holds inline (a spear windup
 * repeats its first frame), so a list plays verbatim. One-shot by default, since an authored list is one
 * complete motion and only some lists author a trailing rest pad.
 */
export interface FrameListAnim {
  /** Bob id of the pool's frame 0, which the local {@link frameLists} indices add to. */
  readonly start: number;
  /** Per-facing ordered lists of local frame indices into the pool. */
  readonly frameLists: readonly (readonly number[])[];
  readonly ticksPerFrame?: number;
  /** Wrap past the last entry instead of returning to the first, for a list driven by the endless free
   *  tick clock (an idle wait cycle), which would otherwise freeze after one play at world start. */
  readonly loop?: boolean;
}

export type SpriteFrameRef = number | DirectionalAnim | FrameListAnim;

/** A settler's frames per coarse sprite state. `idle` is the required base that every other slot falls
 *  back to. */
export interface SettlerStateBinding {
  readonly idle: SpriteFrameRef;
  readonly moving?: SpriteFrameRef;
  readonly acting?: SpriteFrameRef;
  /** Per-atomic override for the `acting` state (the `setatomic` join). */
  readonly byAtomic?: Readonly<Record<number, SpriteFrameRef>>;
  /** The clips an in-house craft program plays, keyed by `subClipKey(action, subId)`. Each is stretched
   *  over its window rather than clocked, so one play fills the window whatever its length. */
  readonly bySubClip?: Readonly<Record<string, SpriteFrameRef>>;
  /**
   * The loaded gait in effect while the item hauls a good. Each slot falls back to its un-loaded
   * counterpart. A bound atomic still wins, since a settler only carries after harvesting empty-handed.
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
  /**
   * The gait while seated in a vehicle's crew: the trader's `human_man_z00Trader_walk` cart pull, which
   * the original binds to the trader job and draws only with a cart in hand. A lone crewless trader
   * walks the plain gait. Falls back to the un-seated slot.
   */
  readonly crew?: {
    readonly moving?: SpriteFrameRef;
  };
}

/**
 * The generic hauling look plus an optional per-good table, since the original draws a different carry
 * cycle per hauled good (`human_man_generic_walk_wood`, `_walk_stone`, `_walk_fish`).
 */
export interface CarryingBinding {
  readonly idle?: SpriteFrameRef;
  readonly moving?: SpriteFrameRef;
  /** Per-`Carrying.goodType` look; a miss uses the generic slots. */
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
  readonly byJob: Readonly<Record<number, T>>;
  /** Looks for an `Age`-carrying (born-young) settler, keyed by its age-class `jobType` (1..4). */
  readonly youngByJob?: Readonly<Record<number, T>>;
  /** Permanent authored arms by job (heroes); selected before mutable equipment state. */
  readonly fixedByJob?: Readonly<Record<number, T>>;
  /** A warrior's look by equipped weapon good, since the drawn weapon follows the equipment slot rather
   *  than the job. */
  readonly byWeaponGood?: Readonly<Record<number, T>>;
  /**
   * A weapon-job's bare-hands look, picked when the `Equipment` weapon slot is explicitly empty
   * (`weaponGood` null). Only weapon-carrying jobs are keyed; a settler with no `Equipment` at all never
   * reaches this table.
   */
  readonly unarmedByJob?: Readonly<Record<number, T>>;
  readonly default: T;
}
