import type { ContentSet } from '@open-northland/data';

/** Tuned by eye to part from each other at a glance on grass, sand and snow. */
const STRENGTH_EMBER = 0xff5a2e;
const DEFENCE_STEEL = 0x4fc3ff;
const CRITICAL_GOLD = 0xffd23f;
const PLENTY_LIME = 0xa6ff5c;
const STAMINA_VIOLET = 0xc790ff;

/** The amulets whose carrier shows an arc of light round the feet, by good slug. The speed amulet
 *  stays unmarked here. */
const AMULET_ARC_COLOUR: Readonly<Record<string, number>> = {
  amulet_strength: STRENGTH_EMBER,
  amulet_defense: DEFENCE_STEEL,
  amulet_crithit: CRITICAL_GOLD,
  amulet_food: PLENTY_LIME,
  amulet_stamina: STAMINA_VIOLET,
};

/** Good type → arc colour for the running content, whose type ids are its own while slugs are stable. */
export function amuletArcColours(goods: ContentSet['goods']): ReadonlyMap<number, number> {
  const colours = new Map<number, number>();
  for (const good of goods) {
    const colour = AMULET_ARC_COLOUR[good.id];
    if (colour !== undefined) colours.set(good.typeId, colour);
  }
  return colours;
}
