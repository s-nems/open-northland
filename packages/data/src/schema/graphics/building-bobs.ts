import { z } from 'zod';
import { Provenance, TypeId } from '../record.js';

/** The fields every `[GfxHouse]` render binding shares, keyed by `(tribeId, typeId, level)`. */
const BuildingBobBase = z.strictObject({
  /** `LogicTribeType` - the tribe the record applies to (viking 1, frank 2); the same `typeId` recurs per tribe. */
  tribeId: TypeId,
  /** `LogicType` - the building typeId at this level (the sim's `Building.buildingType`). */
  typeId: TypeId,
  /** The `LogicType`/`GfxBobId` leading int - the growth level (a home spans 0..4). */
  level: z.number().int().nonnegative(),
  /** `GfxBobLibs` first value - the body bob set, normalized to lower-case with forward slashes. */
  bmd: z.string(),
  /** `GfxBobLibs` second value, normalized - 1-bit shadow silhouettes at the same bob ids as the body. */
  shadowBmd: z.string().optional(),
  /** One `GfxPalette` value, lower-cased - the recolour skin keying this bob's atlas (`house01`, `house02`). */
  paletteName: z.string(),
  /** `EditName` - the record's building handle. */
  editName: z.string().optional(),
  source: Provenance.optional(),
});

/**
 * One `[GfxHouse]` building-type → house-bob binding: the record's `LogicType <level> <typeId>` and
 * `GfxBobId <level> <bobId>` tables joined by level, resolved to one `(bmd, palette, bobId)` row.
 */
export const BuildingBob = BuildingBobBase.extend({
  /** `GfxBobId` - the atlas bob this `(typeId, level)` draws. */
  bobId: z.number().int().nonnegative(),
});
export type BuildingBob = z.infer<typeof BuildingBob>;

/**
 * One `[GfxHouse]` construction-stage layer: `GfxBobConstructionLayer <sizeIdx> <upgrade> <bobId>
 * <shadowBobId|-1> <fromPct> <toPct>`. A level's ranges overlap: at build progress `p` every layer
 * whose range contains `p` draws, stacked in file order, so the last active layer lands on top.
 *
 * The `upgrade` rows reference the next size level's finished body rather than this level's
 * from-scratch construction; their exact semantics are undecoded (source basis).
 */
export const BuildingConstructionLayer = BuildingBobBase.extend({
  /** True for the source's `1` rows - the upgrade layers a from-scratch render skips. */
  upgrade: z.boolean(),
  /** Position of this layer in the record's file order - the stacking order at draw time. */
  stackIdx: z.number().int().nonnegative(),
  /** The atlas bob to draw while this layer is active. */
  bobId: z.number().int().nonnegative(),
  /** The layer's shadow bob; the source's `-1` (none) becomes absent. */
  shadowBobId: z.number().int().nonnegative().optional(),
  /** Build progress percent at which the layer appears (inclusive). */
  fromPct: z.number().int().min(0).max(100),
  /** Build progress percent up to which the layer stays visible (inclusive). */
  toPct: z.number().int().min(0).max(100),
});
export type BuildingConstructionLayer = z.infer<typeof BuildingConstructionLayer>;

/**
 * One `[GfxHouse]` sign-post anchor: `GfxFlagPoint <sizeIdx> <x> <y>`, where a building's
 * occupancy/construction sign chain stands. The key sits in `Game.exe`'s `[GfxHouse]` key list and the
 * values come from the mod's plaintext `houses.ini`. Reading `x y` as screen pixels from the building
 * bob's draw anchor, +y down, is an approximation inferred from the sibling pixel keys' grammar.
 */
export const BuildingFlagPoint = z.strictObject({
  tribeId: TypeId,
  typeId: TypeId,
  /** The `GfxFlagPoint` leading int - the growth level, joined to `typeId` via `LogicType`. */
  level: z.number().int().nonnegative(),
  /** Pixel offset from the building bob's draw anchor (+y down/toward the viewer). */
  x: z.number().int(),
  y: z.number().int(),
  editName: z.string().optional(),
  source: Provenance.optional(),
});
export type BuildingFlagPoint = z.infer<typeof BuildingFlagPoint>;

/**
 * One `[GfxHouse]` animated state overlay: `GfxOverlay <sizeIdx> 4 <state> <x> <y> <step> <bobId…>` - a
 * sprite drawn on top of the finished body, with one frame list per state. The source uses it for the
 * tribes' mills, whose body bob has no rotor blades, and for the frank mason hut.
 *
 * Only the type-`4` rows (the 2nd int) are extracted; the type-`3` rows have a different, undecoded
 * field shape and are skipped rather than guessed.
 */
export const BuildingOverlay = BuildingBobBase.extend({
  /** The 3rd int: `0` = idle (one still frame), `1` = working (the spin cycle). */
  state: z.number().int().nonnegative(),
  /** Pixel offsets of the overlay (the 4th/5th ints; observed `0 0` on every type-4 row). */
  x: z.number().int(),
  y: z.number().int(),
  /** The 6th int (observed `1` on every type-4 row; playback-step semantics undecoded, kept raw). */
  step: z.number().int(),
  /** The state's frame list, in file order. */
  frames: z.array(z.number().int().nonnegative()).min(1),
});
export type BuildingOverlay = z.infer<typeof BuildingOverlay>;
