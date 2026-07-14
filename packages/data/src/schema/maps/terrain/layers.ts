import { z } from 'zod';

/**
 * The 1:1 ground-texture layer of a decoded map: the original's `empa`/`empb` per-cell lanes hold the
 * final per-triangle {@link GfxPattern} choice (the editor bakes its pattern algorithm's output
 * into the save), referenced through the map's own `eapd` pattern-name dictionary. {@link patterns}
 * is that dictionary compacted to the names this map actually uses; {@link a}/{@link b} give each
 * cell's two triangles (A = top, B = bottom of the diamond) as indices into it. The renderer joins a
 * name onto the extracted {@link GfxPattern} table (`EditName` is the engine's own version-robust
 * join key) for the texture page + UV coords.
 */
export const TerrainGround = z.strictObject({
  /** The pattern `EditName`s this map uses (compacted from the map's `eapd` dictionary). */
  patterns: z.array(z.string()),
  /** Row-major per-cell index into {@link patterns} for triangle A (length = width*height). */
  a: z.array(z.number().int().nonnegative()),
  /** Row-major per-cell index into {@link patterns} for triangle B (length = width*height). */
  b: z.array(z.number().int().nonnegative()),
});
export type TerrainGround = z.infer<typeof TerrainGround>;

/**
 * The transition-overlay layer of a decoded map: the original's `emt1..emt4` per-cell u8 lanes,
 * each a per-TRIANGLE overlay pick — `emt1`/`emt2` are layer 1 (drawn last, on top) for triangles
 * A/B, `emt3`/`emt4` layer 2 (under layer 1) for A/B. A lane value `v < 255` selects transition
 * `⌊v/6⌋` from the map's `eatd` dictionary ({@link types}, kept verbatim so the positional join
 * survives) and pair variant `v % 6` of its six `GfxCoords` pairs; `255` = no overlay. A name
 * joins onto the extracted {@link GfxPatternTransition} table (`editName`), mirroring how
 * {@link TerrainGround} joins patterns.
 */
export const TerrainTransitions = z.strictObject({
  /** The map's `eatd` transition-name dictionary, VERBATIM (lane `⌊v/6⌋` indexes it positionally). */
  types: z.array(z.string()),
  /** Row-major per-cell `emt1` lane — layer 1 (topmost), triangle A. Raw u8; 255 = none. */
  a1: z.array(z.number().int().nonnegative()),
  /** Row-major per-cell `emt2` lane — layer 1 (topmost), triangle B. Raw u8; 255 = none. */
  b1: z.array(z.number().int().nonnegative()),
  /** Row-major per-cell `emt3` lane — layer 2 (under layer 1), triangle A. Raw u8; 255 = none. */
  a2: z.array(z.number().int().nonnegative()),
  /** Row-major per-cell `emt4` lane — layer 2 (under layer 1), triangle B. Raw u8; 255 = none. */
  b2: z.array(z.number().int().nonnegative()),
});
export type TerrainTransitions = z.infer<typeof TerrainTransitions>;

/**
 * The placed landscape objects of a decoded map: the original's `emla` lane is a half-cell
 * (2·width × 2·height) grid of indices into the map's `eald` object-name dictionary — every tree,
 * stone, bush, mine decal and animated wave the map ships. {@link types} is that dictionary compacted
 * to the names actually placed; {@link placements} is the sparse flat list of `[hx, hy, typeIndex]`
 * triples (half-cell coordinates — divide by 2 for the cell, the remainder is the sub-cell corner),
 * row-major order. A name joins onto the {@link LandscapeGfx} table for the object's bob frames,
 * palette, animation flags and logic footprints.
 */
export const TerrainObjects = z.strictObject({
  /** The `[GfxLandscape]` `EditName`s this map places (compacted from the map's `eald` dictionary). */
  types: z.array(z.string()),
  /** Flat `[hx, hy, typeIndex]` triples in row-major half-cell order (length % 3 === 0). */
  placements: z.array(z.number().int().nonnegative()),
  /**
   * Per-placement object LEVEL from the `lmlv` lane (parallel to {@link placements}, one entry per
   * triple): 1-based and counting UP FROM THE LOWEST state, while the type's {@link LandscapeGfx}
   * `frames` lists are authored highest-first — so level N (= the list count) is the full-grown
   * tree / full deposit / intact wall (the first list) and level 1 the sapling / dregs / rubble
   * (the last); consumers map `index = N − level`. Walls carry the sentinel `100` (= intact); that
   * and any other out-of-range value render the first (full) list. Absent on maps decoded before
   * the lane was understood (render then defaults to the full state). Direction pinned against the
   * screenshot corpus (source basis "Landscape-object layer").
   */
  levels: z.array(z.number().int().nonnegative()).optional(),
});
export type TerrainObjects = z.infer<typeof TerrainObjects>;
