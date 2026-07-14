import { z } from 'zod';

/**
 * The map's authored entity placements — the `map.cif` `StaticObjects` verbs (`sethouse`/`sethuman`/
 * `setanimal`) decoded verbatim: names stay the original strings (a `sethouse` name is the `[GfxHouse]`
 * `EditName`, a `sethuman` role a `[jobtype]` name), and coordinates stay half-cells (the same
 * `2W × 2H` lattice {@link TerrainObjects} uses; `÷2` → cell). Resolution to sim typeIds happens at
 * load by name against the IR ({@link BuildingBob} `editName`+`level`, {@link JobType} `name`) — the
 * engine's own version-robust join, mirroring how {@link TerrainGround} joins patterns. The
 * `addgoods`/`setproducedgood`/`setguide` verbs (stock, production presets, scout guides) are not
 * captured yet — a tracked gap (source basis map-entity import).
 */
export const TerrainEntities = z.strictObject({
  /**
   * `sethouse` placements: `[GfxHouse]` EditName + level pick the building type. `player` is the
   * verb's first column, 0-based like `sethuman`'s (source basis: its per-value position centroids
   * coincide with the matching `sethuman` clusters across the 13 entity-bearing mod maps). The fourth
   * column is not the owner — it is `1` on 96 of 98 house-placing maps and `0` on the rest, a constant
   * flag, not a player id. `rot` is decoded verbatim with no consumer yet (rotation→facing deferred).
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
