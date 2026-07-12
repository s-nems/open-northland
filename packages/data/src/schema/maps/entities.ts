import { z } from 'zod';

/**
 * The map's authored entity placements — the `map.cif` `StaticObjects` verbs (`sethouse`/`sethuman`/
 * `setanimal`) decoded verbatim: names stay the original strings (a `sethouse` name is the `[GfxHouse]`
 * `EditName`, a `sethuman` role a `[jobtype]` name), and coordinates stay **half-cells** (the same
 * `2W × 2H` lattice {@link TerrainObjects} uses; `÷2` → cell). Resolution to sim typeIds happens at
 * load by NAME against the IR ({@link BuildingBob} `editName`+`level`, {@link JobType} `name`) — the
 * engine's own version-robust join, mirroring how {@link TerrainGround} joins patterns. The
 * `addgoods`/`setproducedgood`/`setguide` verbs (stock, production presets, scout guides) are NOT
 * captured yet — a tracked gap (source basis map-entity import).
 */
export const TerrainEntities = z.strictObject({
  /**
   * `sethouse` placements: `[GfxHouse]` EditName + level pick the building type. `player` is the
   * verb's FIRST column, 0-based like `sethuman`'s (source basis: on all 13 entity-bearing mod maps
   * its per-value position centroids coincide with the matching `sethuman` clusters — value sets
   * equal on the multiplayer/special maps, a sub/superset on four tutorials (scripted/neutral
   * factions; those land unowned via `isValidPlayer`) — so a skirmish map's bases resolve to their
   * OWN players, the original's observed behaviour). This SUPERSEDES the earlier 1-based
   * fourth-column reading (owner = column − 1): that column is `1` on 96 of the 98 house-placing
   * maps in the full unpacked 122-map corpus and `0` on the rest — a constant flag with exceptions,
   * not a player id — and reading it collapsed every skirmish base onto player 0 (the shared-fog
   * bug observed in play).
   * `rot` is decoded verbatim with no consumer yet — the rotation→facing slice is deferred.
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
