import { z } from 'zod';

/**
 * The map's authored entity placements: the `map.cif` `StaticObjects` verbs decoded verbatim. Names
 * stay the original strings (a `sethouse` name is the `[GfxHouse]` `EditName`, a `sethuman` role a
 * `[jobtype]` name) and coordinates stay half-cells; both resolve to sim typeIds by name at load.
 *
 * `missionId` is the mission object id the map's `[MissionData]` goals and results address the
 * placement by; ids are not unique, one names a group.
 */

/** Absent when the verb wrote the corpus's "carries nothing" zero, as every id and mask column does. */
const MissionObjectId = z.number().int().nonnegative().optional();

/** Authored starting stock, the `addgoods` run after a `sethouse` or `setvehicle`: goodtype names
 *  verbatim, with the rare numeric variant kept as a digit string and resolved by typeId at load. */
const AuthoredGoods = z
  .array(z.strictObject({ name: z.string(), count: z.number().int().positive() }))
  .optional();

export const TerrainEntities = z.strictObject({
  /**
   * `sethouse` placements: `[GfxHouse]` EditName + level pick the building type. `player` is the
   * verb's first column, 0-based like `sethuman`'s (observation: its per-value position centroids
   * coincide with the matching `sethuman` clusters). The fourth column is a constant flag, not an
   * owner: `1` on 96 of 98 house-placing maps and `0` on the rest.
   */
  buildings: z
    .array(
      z.strictObject({
        name: z.string(),
        level: z.number().int().nonnegative(),
        player: z.number().int().nonnegative(),
        hx: z.number().int().nonnegative(),
        hy: z.number().int().nonnegative(),
        missionId: MissionObjectId,
        goods: AuthoredGoods,
      }),
    )
    .default([]),
  /** `sethuman` placements: tribe + `[jobtype]` role names; `player` is the verb's first value (0-based). */
  humans: z
    .array(
      z.strictObject({
        tribe: z.string(),
        role: z.string(),
        player: z.number().int().nonnegative(),
        hx: z.number().int().nonnegative(),
        hy: z.number().int().nonnegative(),
        missionId: MissionObjectId,
        /** The 32-bit behaviour mask the `*BehaviourFlag` results share. */
        behaviourFlags: z.number().int().nonnegative().optional(),
        /** A gatherer's authored resource pick, the `setproducedgood` in this settler's `sethuman`
         *  block (goodtype name verbatim). Absent = gather every good the trade may harvest. */
        producedGood: z.string().optional(),
        /** The buildings this settler is authored into (`attachtohouse`), each naming a `sethouse` anchor
         *  half-cell. `slot` is the source's own column, kept verbatim and read by nothing. */
        attach: z
          .array(
            z.strictObject({
              hx: z.number().int().nonnegative(),
              hy: z.number().int().nonnegative(),
              slot: z.number().int().nonnegative(),
            }),
          )
          .optional(),
        /** The vehicle this settler crews (`attachtovehicle`), by the `setvehicle` half-cell it stands on;
         *  `inside` when a `moveintovehicle` follows, which boards the settler off the map. */
        boardVehicleAt: z
          .strictObject({
            hx: z.number().int().nonnegative(),
            hy: z.number().int().nonnegative(),
            inside: z.boolean(),
          })
          .optional(),
      }),
    )
    .default([]),
  /** `setanimal` placements: the species is the verb's `[animaltype]` tribe (e.g. `hares`), and
   *  `player` 20 is the wild owner the corpus uses for all but a few hundred herds. */
  animals: z
    .array(
      z.strictObject({
        species: z.string(),
        player: z.number().int().nonnegative(),
        hx: z.number().int().nonnegative(),
        hy: z.number().int().nonnegative(),
        missionId: MissionObjectId,
        /** The verb's last column; its meaning is unconfirmed, so it is kept verbatim. */
        behaviour: z.number().int().nonnegative().optional(),
      }),
    )
    .default([]),
  /** `setvehicle` placements: tribe + `[vehicletype]` name; the verb's optional eighth column is unread. */
  vehicles: z
    .array(
      z.strictObject({
        tribe: z.string(),
        type: z.string(),
        player: z.number().int().nonnegative(),
        hx: z.number().int().nonnegative(),
        hy: z.number().int().nonnegative(),
        missionId: MissionObjectId,
        goods: AuthoredGoods,
      }),
    )
    .default([]),
  /** `setguide` placements: the signposts `DetectGuide` looks for. The verb carries no name. */
  guides: z
    .array(
      z.strictObject({
        player: z.number().int().nonnegative(),
        hx: z.number().int().nonnegative(),
        hy: z.number().int().nonnegative(),
      }),
    )
    .default([]),
});
export type TerrainEntities = z.infer<typeof TerrainEntities>;
