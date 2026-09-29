import type { ContentSet } from './schema/index.js';

/**
 * Every recipe, ramp and base palette name the `humanPalettes` lane or a human look's base references
 * must resolve inside the lane. A look's `randomPalettes` may name no recipe: that roll changes nothing.
 * A set whose lane carries no recipes (a synthetic set) has nothing to check the looks against, and an
 * empty cart recipe name stands for none.
 */
export function checkHumanPalettes(set: ContentSet): string[] {
  const lane = set.humanPalettes;
  if (lane.recipes.length === 0) return [];
  const errors: string[] = [];
  const recipeNames = new Set(lane.recipes.map((r) => r.name));
  const recipe = (name: string, by: string): void => {
    if (name !== '' && !recipeNames.has(name)) errors.push(`${by} names unknown palette recipe "${name}"`);
  };
  for (const r of lane.recipes) {
    for (const patch of r.patches) {
      if (patch.source.kind === 'ramp' && !Object.hasOwn(lane.ramps, patch.source.ramp))
        errors.push(`palette recipe "${r.name}" names unknown ramp "${patch.source.ramp}"`);
    }
  }
  for (const p of lane.players) {
    recipe(p.male, `player ${p.player}`);
    recipe(p.female, `player ${p.player}`);
  }
  for (const [tier, name] of lane.armorRecipes.entries()) recipe(name, `armor tier ${tier}`);
  recipe(lane.cartRecipes.handcart, 'handcart');
  recipe(lane.cartRecipes.oxcart, 'ox cart');
  for (const c of lane.jobChanges) {
    if (c.recipe !== undefined) recipe(c.recipe, `job change ${c.tribe}/${c.job}`);
  }
  for (const look of set.jobGraphics) {
    const by = `job graphics ${look.tribe}/${look.job}`;
    for (const base of [look.bodyPalette, look.headPalette]) {
      if (base !== undefined && !Object.hasOwn(lane.bases, base))
        errors.push(`${by} names unknown base palette "${base}"`);
    }
  }
  return errors;
}
