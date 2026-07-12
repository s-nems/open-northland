import { z } from 'zod';
import { Provenance } from '../record.js';

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

/**
 * One `[GfxHouse]` **animated state overlay**: `GfxOverlay <sizeIdx> 4 <state> <x> <y> <step>
 * <bobId…>` — an extra sprite drawn ON TOP of the finished body, with one frame list per state. The
 * one type-4 user in the source is the MILL: its body bob has NO rotor blades — state `0` is the
 * single standing-still blade frame, state `1` the multi-frame spin cycle the original plays while
 * the mill produces (viking `ls_houses_viking.bmd`: body 70, idle blade 76, spin 85..86 — 13 frames).
 *
 * Only the type-`4` rows (the 2nd int) are extracted — the two-state animated overlays, whose field
 * shape is pinned by comparing every such row in the file (offsets observed `0 0`, step `1`
 * throughout). The type-`3` rows have a DIFFERENT, not-yet-decoded shape (6 fields, no frame list —
 * static decal offsets) and are skipped rather than guessed. Render-binding data like
 * {@link BuildingBob} (same `(tribeId, typeId)` keying, same `(bmd, palette)` atlas resolution); the
 * pure sim ignores it.
 */
export const BuildingOverlay = z.strictObject({
  /** The `LogicTribeType` the record applies to — the same logic `typeId` recurs per tribe. */
  tribeId: z.number().int().nonnegative(),
  /** The building `typeId` at this size level (the `LogicType` value — the sim's `Building.buildingType`). */
  typeId: z.number().int().nonnegative(),
  /** The growth/size level index (the source's leading int). */
  level: z.number().int().nonnegative(),
  /** The overlay state (the 3rd int): `0` = idle (one still frame), `1` = working (the spin cycle). */
  state: z.number().int().nonnegative(),
  /** Pixel offsets of the overlay (the 4th/5th ints; observed `0 0` on every type-4 row). */
  x: z.number().int(),
  y: z.number().int(),
  /** The 6th int (observed `1` on every type-4 row; playback-step semantics undecoded — kept raw). */
  step: z.number().int(),
  /** The state's frame list, in file order — one bob for state 0, the spin cycle for state 1. */
  frames: z.array(z.number().int().nonnegative()).min(1),
  /** The body bob set, normalized — the same `.bmd` the type's {@link BuildingBob} rows index. */
  bmd: z.string(),
  /** One recolour skin (`GfxPalette` value), lower-cased. */
  paletteName: z.string(),
  /** The record's `EditName`, kept as a render/debug handle when present. */
  editName: z.string().optional(),
  source: Provenance.optional(),
});
export type BuildingOverlay = z.infer<typeof BuildingOverlay>;
