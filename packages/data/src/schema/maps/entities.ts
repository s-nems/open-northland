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
export const TerrainEntities = z.object({
  /**
   * `sethouse` placements: `[GfxHouse]` EditName + level pick the building type. `player` is read as
   * 1-based (owner = `player − 1`), which the DATA now bears out across the 122 entity-bearing maps:
   * the column is `1` on 96 of the 98 house-placing maps and only `{0,1}` on two. The 1-based read is
   * pinned by the single-player tutorials — they place houses as `player 1` and the taught human as
   * `player 0`, so `player 1 → owner 0` makes the human own its HQ (a 0-based read would leave the
   * human with none). A `player 0` house lands NEUTRAL (owner −1, dropped by `isValidPlayer`) — a gaia
   * reading consistent with those two maps' scattered civic buildings.
   * CAVEAT — this column does NOT encode per-player base ownership: a skirmish map with N human
   * players still authors EVERY house as `player 1`, so all its bases resolve to owner 0. True
   * per-player ownership must come from the map's `player.inc`/region setup (an unbuilt join), not this
   * field; until then a multi-base map reads as one human's holdings, which is fine for the `?map=`
   * viewer (selection/centre) but not for a real match.
   * `rot` is decoded verbatim with no consumer yet — the rotation→facing slice is deferred
   * (docs/plans/entity-import item).
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
