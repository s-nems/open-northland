import { z } from 'zod';
import { AtomicId, Provenance, TypeId } from '../record.js';

/** One frame list per facing (`dirFrames[d]` is facing `d`), as bob ids of the row's body bob set. The
 *  pipeline resolves a `[bobseq]`-relative record to bob ids, so a consumer never joins a sequence. */
const FacingFrames = z.array(z.array(z.number().int().nonnegative()));

/** A `[gfxanimatomic]` record of the vehicle job: `action` 2 is the wait, 81 the catapult shot, 4 the
 *  ships' second hull. */
export const VehicleClip = z.strictObject({
  action: AtomicId,
  dirFrames: FacingFrames,
});
export type VehicleClip = z.infer<typeof VehicleClip>;

/** A `[gfxwalkatomic]` record of the vehicle job: the drive, keyed by the hauled good (`0` unloaded; the
 *  ships author `wood` for their loaded hull). */
export const VehicleGait = z.strictObject({
  goodType: TypeId,
  dirFrames: FacingFrames,
  /** `gfxturnframelist` per facing when the record authors in-place turns; only the ships do. */
  turnFrames: FacingFrames.optional(),
});
export type VehicleGait = z.infer<typeof VehicleGait>;

/**
 * How one tribe draws one vehicle type: the `[jobgraphics]` body binding of `vehiclestype/jobgraphics.ini`
 * joined with the vehicle job's animation records. The carts and the catapult play `[bobseq]` runs of
 * `cr_veh_body_00.bmd`; the ships' records carry raw bob ids into `ls_vehicles.bmd` with no
 * `gfxbobseqbody`, which is the source basis for the ship jobs 52 and 53 having no `gfxAtomics` rows.
 */
export const VehicleGraphics = z.strictObject({
  /** `logictribe` - the `TRIBE_TYPE_*` id. The shipped data binds tribes 1..4 only; Egypt has no row. */
  tribe: TypeId,
  /** `logicvehicle` - the `VehicleType.typeId`. */
  vehicleType: TypeId,
  /** The `VehicleType.jobId` the animation records were keyed on. */
  job: TypeId,
  /** `gfxbobmanagerbody` slot 0, normalized to lower-case with forward slashes. */
  body: z.string(),
  shadowBody: z.string().optional(),
  /** `gfxpalettebody` editname, lower-cased. */
  bodyPalette: z.string(),
  /**
   * The palette per 0-based player index when the body palette opens a numbered family in `palettes.ini`
   * (`human_ship01` .. `human_ship10`): the ship hull takes the owner's colour. Which family member a
   * player index maps to is inferred from the numbering, which matches the `human_player` family.
   */
  playerPalettes: z.array(z.string()).optional(),
  clips: z.array(VehicleClip).default([]),
  gaits: z.array(VehicleGait).default([]),
  source: Provenance.optional(),
});
export type VehicleGraphics = z.infer<typeof VehicleGraphics>;
