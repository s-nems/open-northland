import { z } from 'zod';
import { Provenance } from '../record.js';

/**
 * One named animation run from `animations.ini`'s `[bobseq]` (`seq "<name>" <start> <length>`) — a
 * directional bob cycle laid out as `dirs` facings back-to-back inside one bob set. The render builds
 * its `DirectionalAnim` from this: `start` is the run's first bob id, `length` the total frame count
 * across all directions (so the per-direction stride is `length / dirs`, `dirs` = 8 for these sprites).
 * This is the data the renderer previously hard-coded as frame-range constants (`WALK` start 1988, …);
 * extracting it removes the guesswork — the frame ids come from the source, not a magic number.
 */
export const BobSequence = z.strictObject({
  /** The exact sequence name (`seq "<name>"`) — the resolvable key, e.g. `human_man_generic_walk`. */
  name: z.string(),
  /** The run's first bob id (frame 0 of direction 0). */
  start: z.number().int().nonnegative(),
  /** Total frame count across every direction (`= dirs * per-direction stride`). */
  length: z.number().int().nonnegative(),
});
export type BobSequence = z.infer<typeof BobSequence>;

/**
 * The `[bobseq]` table for one bob set (`imagelib`) from `animations.ini` — its `imagelib` `.bmd` plus
 * every named {@link BobSequence} that indexes into it. The renderer joins a sequence to a decoded atlas
 * by the `imagelib` stem (`cr_hum_body_00.bmd` → the `cr_hum_body_00.<palette>` atlas), the same id space
 * the bob ids address. Render-binding data (like {@link TerrainPattern}); the pure sim ignores it.
 */
export const BobSequenceSet = z.strictObject({
  /** The bob set this table indexes, normalized (lower-case, forward slashes), e.g. `cr_hum_body_00.bmd`. */
  imagelib: z.string(),
  /** The matching shadow bob set (`shadowlib`), normalized, when the record names one. */
  shadowlib: z.string().optional(),
  /** Named sequences in file order. */
  sequences: z.array(BobSequence).default([]),
  source: Provenance.optional(),
});
export type BobSequenceSet = z.infer<typeof BobSequenceSet>;

/**
 * One `[gfxanimatomic]` record from `mapmoveableanimations/animations.ini` — the atomic-action → body
 * animation binding, joining `(logictribe, logicjob, logicatomicaction)` to the `gfxbobseqbody`
 * `[bobseq]` it plays and, crucially, the **explicit per-direction frame-index lists** that lay that
 * animation out across the 8 facings. Render-binding data (like {@link BobSequenceSet}); the pure sim
 * ignores it.
 *
 * This is the directional layout a {@link BobSequence}'s bare `start`/`length` CANNOT encode: an action
 * animation is NOT a uniform `length / 8` strip. Each `gfxanimframelistdir <dir> <idx…>` line gives one
 * facing its own ordered list of LOCAL frame indices into the bodySeq pool (global bob id =
 * `bodySeq.start + idx`), and those lists differ per facing and author holds/repeats inline (a spear
 * windup repeats its first frame five times, `[79,79,79,79,79,80,…]`) and reuse (mirror directions share
 * frames). A melee swing pool is not even divisible by 8 (`Sword_Attack` 102, `spear_attack` 108), so a
 * `start + facing*stride` slice is meaningless — playback must replay these lists verbatim. A record with
 * a single non-directional `gfxanimframelist` yields ONE list ({@link dirFrames} length 1 = facing-locked).
 */
export const GfxAnimAtomic = z.strictObject({
  /** `logictribe` the record binds — the `logicdefines.inc` `TRIBE_TYPE_*` id (viking 1, frank 2, …), NOT
   *  the tribetypes `logicType`. The same `(job, action)` recurs per tribe with DIFFERENT frame lists, so
   *  a consumer MUST filter by the right tribe (viking = 1) or it draws a plausible-but-wrong swing. */
  tribe: z.number().int().nonnegative(),
  /** `logicjob` — the soldier/settler jobType whose atomic this animates (soldiers 31..41, civilist 6, woman 5). */
  job: z.number().int().nonnegative(),
  /** `logicatomicaction` — the atomic slot (81 ATTACK, …), the same numeric id the sim's `setatomic` join keys. */
  action: z.number().int().nonnegative(),
  /** The `gfxbobseqbody` `[bobseq]` name whose frame pool the {@link dirFrames} index into. */
  bodySeq: z.string(),
  /** The `gfxbobseqhead` `[bobseq]` name, when the record overlays a separate head bob. Extracted ahead
   *  of a consumer: the render currently draws the head at the body's resolved bob id (the head atlas
   *  covers every body frame), so this is unread today — kept for a future separate-head attack overlay. */
  headSeq: z.string().optional(),
  /**
   * Per-direction frame-index lists — one array per facing (`gfxanimframelistdir <dir> <idx…>` placed at
   * its `<dir>` slot, so `dirFrames[d]` is facing `d` regardless of file order), each a list of LOCAL
   * indices into the {@link bodySeq} pool. A non-directional record (`gfxanimframelist`) yields a single
   * list (length-1 outer array = facing-locked). Replayed verbatim — the authored holds/repeats ARE the
   * cadence, never a uniform slice.
   */
  dirFrames: z.array(z.array(z.number().int().nonnegative())),
  source: Provenance.optional(),
});
export type GfxAnimAtomic = z.infer<typeof GfxAnimAtomic>;

/**
 * One `[GfxHouse]` building-type → house-bob binding: which atlas bob a building of a given
 * `(tribeId, typeId)` draws, the data-pinned twin of the renderer's hand-transcribed per-type table.
 * Each `[GfxHouse]` record pairs a `LogicType <level> <typeId>` table with a `GfxBobId <level> <bobId>`
 * table by the **level index** (a home spans levels 0..4, five distinct typeIds at five rising bobs),
 * and names the body `.bmd` (`GfxBobLibs`) recoloured by one-or-more palette skins (`GfxPalette`); this
 * is one row of that join — a single `(tribeId, typeId, level)` resolved to its `(bmd, palette, bobId)`.
 * Render-binding data (like {@link BobSequenceSet}/{@link TerrainPattern}); the pure sim ignores it. The
 * render picks the row matching the atlas it loaded — `(bmd, palette)` — and draws `bobId` for the
 * building's `Building.buildingType` ({@link typeId}), so each type shows its own house bob from data
 * instead of a transcribed constant.
 */
export const BuildingBob = z.strictObject({
  /** The `LogicTribeType` the record applies to (viking 1, frank 2, …) — the same logic `typeId` recurs per tribe. */
  tribeId: z.number().int().nonnegative(),
  /** The building `typeId` (the sim's `Building.buildingType`, the `[GfxHouse]` `LogicType` value at this level). */
  typeId: z.number().int().nonnegative(),
  /** The growth/size level index (`LogicType`/`GfxBobId`'s leading int) — a home's tier 0..4. */
  level: z.number().int().nonnegative(),
  /** The body bob set, normalized (lower-case, forward slashes), e.g. `data/engine2d/bin/bobs/ls_houses_viking.bmd`. */
  bmd: z.string(),
  /** One recolour skin (`GfxPalette` value), lower-cased — the atlas this bob is drawn in (`house01`/`house02`/…). */
  paletteName: z.string(),
  /** The atlas bob id this `(typeId, level)` draws (the `GfxBobId` for the level). */
  bobId: z.number().int().nonnegative(),
  /** The record's `EditName` (`"viking home"`), kept as a render/debug handle when present. */
  editName: z.string().optional(),
  source: Provenance.optional(),
});
export type BuildingBob = z.infer<typeof BuildingBob>;

/**
 * One `[GfxHouse]` **construction-stage layer**: `GfxBobConstructionLayer <sizeIdx> <upgrade> <bobId>
 * <shadowBobId|-1> <fromPct> <toPct>` — which atlas bob(s) an under-construction building draws at a
 * given build progress. A record lists several layers per size level with OVERLAPPING `[fromPct,
 * toPct]` ranges; at progress `p` (percent, 0..100) every layer whose range contains `p` draws,
 * STACKED in file order (`stackIdx`) — the last-listed active layer (the finished body, whose range
 * always ends at 100) lands on top. At `p = 0` only the first stage (the grey foundation, range
 * starting at 0) is visible; at `p = 100` only the finished body (+ its shadow) remains.
 *
 * `upgrade` (the source's second int, 0 or 1): the 1-rows reference the NEXT size level's finished
 * body and are NOT part of this level's from-scratch construction — they belong to the original's
 * upgrade-in-progress overlay (semantics not fully decoded; source basis). Consumers of the
 * from-scratch construction render use only the `upgrade === false` rows.
 *
 * Render-binding data like {@link BuildingBob} (same `(tribeId, typeId)` keying, same `(bmd,
 * palette)` atlas resolution); the pure sim ignores it.
 */
export const BuildingConstructionLayer = z.strictObject({
  /** The `LogicTribeType` the record applies to — the same logic `typeId` recurs per tribe. */
  tribeId: z.number().int().nonnegative(),
  /** The building `typeId` at this size level (the `LogicType` value — the sim's `Building.buildingType`). */
  typeId: z.number().int().nonnegative(),
  /** The growth/size level index (the source's leading int) — a home's tier 0..4. */
  level: z.number().int().nonnegative(),
  /** True for the source's `1` rows — the upgrade-overlay layers a from-scratch render skips. */
  upgrade: z.boolean(),
  /** Position of this layer in the record's file order — the stacking order at draw time. */
  stackIdx: z.number().int().nonnegative(),
  /** The body bob set, normalized — the same `.bmd` the type's {@link BuildingBob} rows index. */
  bmd: z.string(),
  /** One recolour skin (`GfxPalette` value), lower-cased. */
  paletteName: z.string(),
  /** The atlas bob to draw while this layer is active. */
  bobId: z.number().int().nonnegative(),
  /** The layer's shadow bob, when the source names one (`-1` = none → absent). */
  shadowBobId: z.number().int().nonnegative().optional(),
  /** Build progress percent at which the layer appears (inclusive). */
  fromPct: z.number().int().min(0).max(100),
  /** Build progress percent up to which the layer stays visible (inclusive). */
  toPct: z.number().int().min(0).max(100),
  /** The record's `EditName`, kept as a render/debug handle when present. */
  editName: z.string().optional(),
  source: Provenance.optional(),
});
export type BuildingConstructionLayer = z.infer<typeof BuildingConstructionLayer>;
