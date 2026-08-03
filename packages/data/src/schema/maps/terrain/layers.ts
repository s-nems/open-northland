import { z } from 'zod';

/** A row-major per-cell lane: one non-negative integer per map cell (length = width*height). */
export const CellLane = z.array(z.number().int().nonnegative());

/**
 * The ground-texture layer of a decoded map: the `empa`/`empb` per-cell lanes hold the map's final
 * per-triangle pattern choice, referenced through its own `eapd` pattern-name dictionary. A is the
 * top triangle of the diamond, B the bottom. Names join onto the extracted `GfxPattern` table by
 * `EditName`.
 */
export const TerrainGround = z.strictObject({
  /** The pattern `EditName`s this map uses (compacted from the map's `eapd` dictionary). */
  patterns: z.array(z.string()),
  /** Row-major per-cell index into {@link patterns} for triangle A (length = width*height). */
  a: CellLane,
  /** Row-major per-cell index into {@link patterns} for triangle B (length = width*height). */
  b: CellLane,
});
export type TerrainGround = z.infer<typeof TerrainGround>;

/**
 * The transition-overlay layer of a decoded map: the `emt1..emt4` per-cell u8 lanes, each a
 * per-triangle overlay pick. A lane value `v < 255` selects transition `⌊v/6⌋` from the map's `eatd`
 * dictionary and pair variant `v % 6` of its six `GfxCoords` pairs; `255` = no overlay. Names join
 * onto the extracted `GfxPatternTransition` table by `editName`.
 */
export const TerrainTransitions = z.strictObject({
  /** The map's `eatd` transition-name dictionary, verbatim (lane `⌊v/6⌋` indexes it positionally). */
  types: z.array(z.string()),
  /** Row-major per-cell `emt1` lane - layer 1 (topmost), triangle A. Raw u8; 255 = none. */
  a1: CellLane,
  /** Row-major per-cell `emt2` lane - layer 1 (topmost), triangle B. Raw u8; 255 = none. */
  b1: CellLane,
  /** Row-major per-cell `emt3` lane - layer 2 (under layer 1), triangle A. Raw u8; 255 = none. */
  a2: CellLane,
  /** Row-major per-cell `emt4` lane - layer 2 (under layer 1), triangle B. Raw u8; 255 = none. */
  b2: CellLane,
});
export type TerrainTransitions = z.infer<typeof TerrainTransitions>;

/**
 * The placed landscape objects of a decoded map: the `emla` lane is a half-cell (`2W x 2H`) grid of
 * indices into the map's `eald` object-name dictionary, kept here as the sparse list of placed
 * triples in row-major order. Names join onto the `LandscapeGfx` table.
 */
export const TerrainObjects = z.strictObject({
  /** The `[GfxLandscape]` `EditName`s this map places (compacted from the map's `eald` dictionary). */
  types: z.array(z.string()),
  /** Flat `[hx, hy, typeIndex]` triples in row-major half-cell order (length % 3 === 0). */
  placements: z.array(z.number().int().nonnegative()),
  /**
   * Per-placement object level from the `lmlv` lane, one entry per placement triple: 1-based and
   * counting up from the lowest state, while a type's `LandscapeGfx` `frames` lists are authored
   * highest-first, so consumers map `index = N − level` for a list count of N. Walls carry the
   * sentinel `100`; that and any other out-of-range value render the first (full) list. Absent when
   * the map was decoded without the lane, which renders the full state. Direction pinned by
   * observation against the screenshot corpus.
   */
  levels: z.array(z.number().int().nonnegative()).optional(),
});
export type TerrainObjects = z.infer<typeof TerrainObjects>;
