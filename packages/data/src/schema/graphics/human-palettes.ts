import { z } from 'zod';
import { TypeId } from '../record.js';

/** 256 RGB triples as 1,536 lower-case hex digits (`rrggbb` per palette index). */
export const PaletteHex = z.string().regex(/^[0-9a-f]{1536}$/);
/** One 16-colour `[GfxPalette16]` ramp as 96 lower-case hex digits. */
export const RampHex = z.string().regex(/^[0-9a-f]{96}$/);

/**
 * One `Patch <id> <source> <weight>` line of a `randompalette.ini` `[RandomPalette]` recipe. `band`
 * 0..15 addresses body band `band`, 16..31 head band `band - 16`; a `copy` source reads a band of the
 * palette being composed, addressed the same way.
 */
export const RandomPalettePatch = z.strictObject({
  band: z.number().int().min(0).max(31),
  source: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('ramp'), ramp: z.string() }),
    z.strictObject({ kind: z.literal('copy'), band: z.number().int().min(0).max(31) }),
  ]),
  weight: z.number().int().min(0),
});
export type RandomPalettePatch = z.infer<typeof RandomPalettePatch>;

/**
 * A `[RandomPalette]` recipe: its `Patch` lines in file order. Original behavior: each distinct band, in
 * the order its first line appears, rolls one of its lines by weight; a zero weight sum skips the band.
 */
export const RandomPaletteRecipe = z.strictObject({
  /** `Name`, lower-cased. */
  name: z.string(),
  patches: z.array(RandomPalettePatch),
});
export type RandomPaletteRecipe = z.infer<typeof RandomPaletteRecipe>;

/** The recipes a player's humans receive at creation, by sex. */
export const PlayerPaletteRecipes = z.strictObject({
  /** Player slot, 0..15. */
  player: z.number().int().min(0),
  /** `player_NN` for the original's ten colours; a pipeline-synthesized recipe for the others. */
  male: z.string(),
  /** `woman_NN` for the original's ten colours; a pipeline-synthesized recipe for the others. */
  female: z.string(),
});
export type PlayerPaletteRecipes = z.infer<typeof PlayerPaletteRecipes>;

/** A `[jobchangegraphics]` record's palette part: the recipe a human rolls on changing into `job`.
 *  Original behavior: a record listing several `gfxpaletterandom` lines keeps the last. */
export const JobChangePalette = z.strictObject({
  tribe: TypeId,
  job: TypeId,
  /** The recipe name, lower-cased; absent when the record names none the recipes carry, so it applies
   *  nothing and the job does not fall back to its parent job's record. */
  recipe: z.string().optional(),
});
export type JobChangePalette = z.infer<typeof JobChangePalette>;

/** The `good_*` recipe a human carrying `good` lays over its palettes. */
export const GoodPaletteRecipe = z.strictObject({
  good: TypeId,
  /** The recipe name, lower-cased. */
  recipe: z.string(),
});
export type GoodPaletteRecipe = z.infer<typeof GoodPaletteRecipe>;

/**
 * Everything a runtime needs to compose a human's body and head palettes the way the original does:
 * base palettes, then the player recipe, then the job's rolled recipe, then armor or cart recipes, then
 * a carried good's recipe. Only recipes, ramps and bases some human look, player, armor tier, cart or
 * good can reach are included.
 */
export const HumanPalettes = z.strictObject({
  /** `[GfxPalette256]` editname (lower-cased) → its colours. */
  bases: z.record(z.string(), PaletteHex),
  /** `[GfxPalette16]` name (lower-cased) → its resolved 16 colours. */
  ramps: z.record(z.string(), RampHex),
  recipes: z.array(RandomPaletteRecipe),
  players: z.array(PlayerPaletteRecipes),
  /** `human_armor_000`..`004` by `TArmorType`, lower-cased; index = tier. */
  armorRecipes: z.array(z.string()),
  /** Recipe names a crewed handcart and ox cart apply to their driver, lower-cased. */
  cartRecipes: z.strictObject({ handcart: z.string(), oxcart: z.string() }),
  jobChanges: z.array(JobChangePalette),
  goodRecipes: z.array(GoodPaletteRecipe),
});
export type HumanPalettes = z.infer<typeof HumanPalettes>;

/** The lane a synthetic content set without human palettes carries. */
export const emptyHumanPalettes: HumanPalettes = {
  bases: {},
  ramps: {},
  recipes: [],
  players: [],
  armorRecipes: [],
  cartRecipes: { handcart: '', oxcart: '' },
  jobChanges: [],
  goodRecipes: [],
};
