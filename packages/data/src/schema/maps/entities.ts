import { z } from 'zod';

/**
 * The map's authored entity placements: the `map.cif` `StaticObjects` verbs (`sethouse`/`sethuman`/
 * `setanimal`) decoded verbatim. Names stay the original strings (a `sethouse` name is the
 * `[GfxHouse]` `EditName`, a `sethuman` role a `[jobtype]` name) and coordinates stay half-cells;
 * both resolve to sim typeIds by name at load. The `setguide` verb (scout guides) is not captured.
 */
export const TerrainEntities = z.strictObject({
  /**
   * `sethouse` placements: `[GfxHouse]` EditName + level pick the building type. `player` is the
   * verb's first column, 0-based like `sethuman`'s (observation: its per-value position centroids
   * coincide with the matching `sethuman` clusters). The fourth column is a constant flag, not an
   * owner: `1` on 96 of 98 house-placing maps and `0` on the rest. `rot` has no consumer yet.
   */
  buildings: z
    .array(
      z.strictObject({
        name: z.string(),
        level: z.number().int().nonnegative(),
        player: z.number().int().nonnegative(),
        hx: z.number().int().nonnegative(),
        hy: z.number().int().nonnegative(),
        rot: z.number().int().nonnegative().optional(),
        /** Authored starting stock, the `addgoods` runs after this `sethouse`: goodtype names verbatim,
         *  with the rare numeric variant kept as a digit string and resolved by typeId at load. */
        goods: z.array(z.strictObject({ name: z.string(), count: z.number().int().positive() })).optional(),
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
      }),
    )
    .default([]),
  /** `setanimal` placements: species name (an `[animaltype]` tribe, e.g. `hares`). */
  animals: z
    .array(
      z.strictObject({
        species: z.string(),
        hx: z.number().int().nonnegative(),
        hy: z.number().int().nonnegative(),
      }),
    )
    .default([]),
});
export type TerrainEntities = z.infer<typeof TerrainEntities>;
