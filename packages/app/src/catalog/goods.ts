/**
 * The committed catalog of the extended goods: every `goodtypes.ini` ware beyond the six gathered goods
 * and coin the sandbox wires end-to-end in `game/sandbox/ids/`, so the one global content set names
 * every good the original defines.
 *
 * Source basis: `id` and catalog order are transcribed verbatim from the extracted `content/ir.json`
 * goods; `name` is hand-authored English. Icons resolve by string id through
 * `content/goods/manifest.json`, so no typeId has to match for art to appear.
 */

/** Added to each ir.json good typeId to mint its sandbox-scoped id, clearing the core ids (≤ 14). */
export const EXTENDED_GOOD_TYPE_OFFSET = 100;

export interface CatalogGood {
  /** Sandbox-scoped `goodType`: {@link EXTENDED_GOOD_TYPE_OFFSET} plus the ir.json typeId. */
  readonly typeId: number;
  /** Stable machine id, verbatim from `ir.json`, and the `ls_goods` icon-manifest key. */
  readonly id: string;
  readonly name: string;
  /** False for the animal, vehicle and special tokens, which are herded, driven or sentinel rather than
   *  carried. Which carried wares a store slots is the sandbox store set's call, not this flag's. */
  readonly storable: boolean;
}

/** The extended goods in ir.json typeId order. */
export const EXTENDED_GOODS: readonly CatalogGood[] = [
  { typeId: 101, id: 'water', name: 'Water', storable: true },
  { typeId: 104, id: 'wheat', name: 'Wheat', storable: true },
  { typeId: 109, id: 'leather', name: 'Leather', storable: true },
  { typeId: 110, id: 'wool', name: 'Wool', storable: true },
  { typeId: 111, id: 'flour', name: 'Flour', storable: true },
  { typeId: 112, id: 'honey', name: 'Honey', storable: true },
  { typeId: 113, id: 'herb', name: 'Herb', storable: true },
  { typeId: 115, id: 'holy_oil', name: 'Holy Oil', storable: true },
  { typeId: 116, id: 'food_simple', name: 'Simple Food', storable: true },
  { typeId: 117, id: 'food_extra', name: 'Fine Food', storable: true },
  // Fruit (118) is curated out of this catalog, not the IR: its `goods all` record reuses bread's frames,
  // so it can only ever read as bread.
  { typeId: 119, id: 'bread', name: 'Bread', storable: true },
  { typeId: 120, id: 'candy', name: 'Candy', storable: true },
  { typeId: 121, id: 'meat', name: 'Meat', storable: true },
  // Fish (122) and sausage (123) are curated out for the same reason: `landscapes.cif` binds both to
  // gold's bar frames, so they can only ever read as gold bars, and `meat` already covers produced food.
  { typeId: 124, id: 'brick', name: 'Brick', storable: true },
  { typeId: 125, id: 'tile', name: 'Roof Tile', storable: true },
  { typeId: 126, id: 'pillar', name: 'Pillar', storable: true },
  { typeId: 127, id: 'ornament', name: 'Ornament', storable: true },
  { typeId: 128, id: 'crockery', name: 'Crockery', storable: true },
  { typeId: 129, id: 'furniture', name: 'Furniture', storable: true },
  { typeId: 130, id: 'shoes', name: 'Shoes', storable: true },
  { typeId: 131, id: 'tool_wooden', name: 'Wooden Tool', storable: true },
  { typeId: 132, id: 'tool_iron', name: 'Iron Tool', storable: true },
  { typeId: 133, id: 'armor_wool', name: 'Cloth Armor', storable: true },
  { typeId: 134, id: 'armor_leather', name: 'Leather Armor', storable: true },
  { typeId: 135, id: 'armor_chain', name: 'Chain Armor', storable: true },
  { typeId: 136, id: 'armor_plate', name: 'Plate Armor', storable: true },
  { typeId: 137, id: 'bow_short', name: 'Short Bow', storable: true },
  { typeId: 138, id: 'bow_long', name: 'Long Bow', storable: true },
  { typeId: 139, id: 'spear_wooden', name: 'Wooden Spear', storable: true },
  { typeId: 140, id: 'spear_iron', name: 'Iron Spear', storable: true },
  // `sword_shord` keeps the source's misspelling so the icon key still matches.
  { typeId: 141, id: 'sword_shord', name: 'Short Sword', storable: true },
  { typeId: 142, id: 'sword_long', name: 'Long Sword', storable: true },
  { typeId: 143, id: 'mead', name: 'Mead', storable: true },
  { typeId: 144, id: 'potion_food_small', name: 'Small Food Potion', storable: true },
  { typeId: 145, id: 'potion_food_big', name: 'Large Food Potion', storable: true },
  { typeId: 146, id: 'potion_stamina_small', name: 'Small Stamina Potion', storable: true },
  { typeId: 147, id: 'potion_stamina_big', name: 'Large Stamina Potion', storable: true },
  { typeId: 148, id: 'potion_heal_small', name: 'Small Healing Potion', storable: true },
  { typeId: 149, id: 'potion_heal_big', name: 'Large Healing Potion', storable: true },
  { typeId: 150, id: 'amulet_food', name: 'Amulet of Plenty', storable: true },
  { typeId: 151, id: 'amulet_stamina', name: 'Amulet of Stamina', storable: true },
  { typeId: 152, id: 'amulet_strength', name: 'Amulet of Strength', storable: true },
  { typeId: 153, id: 'amulet_defense', name: 'Amulet of Defense', storable: true },
  { typeId: 154, id: 'amulet_crithit', name: 'Amulet of the Critical Blow', storable: true },
  { typeId: 155, id: 'amulet_speed', name: 'Amulet of Speed', storable: true },
  // Real goodtypes, but herded, driven or sentinel rather than warehoused, so no stock slot and no icon.
  { typeId: 156, id: 'prey', name: 'Game', storable: false },
  { typeId: 157, id: 'sheep', name: 'Sheep', storable: false },
  { typeId: 158, id: 'cattle', name: 'Cattle', storable: false },
  { typeId: 159, id: 'handcart', name: 'Handcart', storable: false },
  { typeId: 160, id: 'oxcart', name: 'Ox Cart', storable: false },
  { typeId: 161, id: 'ship_small', name: 'Small Ship', storable: false },
  { typeId: 162, id: 'ship_big', name: 'Large Ship', storable: false },
  { typeId: 163, id: 'catapult', name: 'Catapult', storable: false },
  { typeId: 164, id: 'chest', name: 'Chest', storable: false },
  { typeId: 165, id: 'anything', name: 'Anything', storable: false },
] as const;

/** The carried subset the general-goods store set is drawn from. */
export const STORABLE_EXTENDED_GOODS: readonly CatalogGood[] = EXTENDED_GOODS.filter((g) => g.storable);
