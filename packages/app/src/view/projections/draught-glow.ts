import type { ContentSet } from '@open-northland/data';

/** The bright end of each potion bottle's ramp in the original's goods art. */
const HEALING_ORANGE = 0xfba73f;
const FOOD_RED = 0xe1222e;
const STAMINA_GOLD = 0xe4c954;

/** The potions whose sip shows on the drinker, by good slug. Mead and the amulets' top-ups stay unmarked. */
const POTION_GLOW_COLOUR: Readonly<Record<string, number>> = {
  potion_heal_small: HEALING_ORANGE,
  potion_heal_big: HEALING_ORANGE,
  potion_food_small: FOOD_RED,
  potion_food_big: FOOD_RED,
  potion_stamina_small: STAMINA_GOLD,
  potion_stamina_big: STAMINA_GOLD,
};

/** Good type → glow colour for the running content, whose type ids are its own while slugs are stable. */
export function draughtGlowColours(goods: ContentSet['goods']): ReadonlyMap<number, number> {
  const colours = new Map<number, number>();
  for (const good of goods) {
    const colour = POTION_GLOW_COLOUR[good.id];
    if (colour !== undefined) colours.set(good.typeId, colour);
  }
  return colours;
}
