/**
 * The player-colour LUT's row-block layout, shared by the pipeline that writes it and the app that reads
 * it: one block of player rows per armor tier (`TArmorType` 0..4), then one per cart recipe below, then
 * the head row.
 */

/** Armor-tier blocks: none, wool, leather, chain, plate. */
export const PLAYER_LUT_ARMOR_BLOCKS = 5;

/**
 * The `randompalette.ini` recipes a crewed cart's composite draws its driver through, in block order after
 * the armor blocks: the handcart's and the ox cart's patch of the human palette.
 */
export const PLAYER_LUT_CART_RECIPES = ['good_HandCart', 'good_OxCart'] as const;

export type PlayerLutCartRecipe = (typeof PLAYER_LUT_CART_RECIPES)[number];

/** The block index a cart recipe's rows start at. */
export function playerLutCartBlock(recipe: PlayerLutCartRecipe): number {
  return PLAYER_LUT_ARMOR_BLOCKS + PLAYER_LUT_CART_RECIPES.indexOf(recipe);
}
