/**
 * The committed catalog of the extended goods — every tradeable ware in the original economy beyond the
 * six gathered goods + coin the sandbox already wires end-to-end (wood/stone/mud/iron/gold/mushroom have
 * harvest atomics and a gathering pipeline; those live in `game/sandbox/ids/` + `content/`, since they
 * carry behaviour). This table adds the rest of the `goodtypes.ini` catalog — food, drink, building
 * materials, tools, crafted wares, weapons, armor, potions, amulets, and the animal/vehicle/special tokens
 * — so every good the original defines exists in the one global content set: it has an id, a name, and (for
 * the wares) a warehouse stock slot + its recoloured `ls_goods` HUD icon, drawable in the Magazyn panel.
 *
 * Source basis: `id` and catalog order are transcribed verbatim from the extracted `content/ir.json` goods
 * (itself decoded from `Data/logic/goodtypes.ini`); `name` is our own clean-room English naming. The icon
 * for each ware resolves by its string id through `content/goods/manifest.json` (the `ls_goods` frame +
 * palette the pipeline bound), so no typeId needs to match for art to appear.
 *
 * The `typeId` is sandbox-scoped, not the ir.json typeId: it is `EXTENDED_GOOD_TYPE_OFFSET + irTypeId`,
 * offset so the block clears the core economy ids 0–8 (`GOOD_NONE`..`GOOD_MUSHROOM` in `sandbox/ids/`)
 * without renumbering them (which would move the gathered-economy goldens). Subtracting the offset recovers
 * the ir typeId. Goods are their own typeId namespace (the `goodType` key in stockpiles/recipes/drops), so
 * this block collides with no building/job/weapon id.
 */

/** The offset added to each ir.json good typeId to mint its sandbox-scoped id, clearing the core 0–8 block. */
export const EXTENDED_GOOD_TYPE_OFFSET = 100;

/** One extended good: the sim `goodType` key + its stable icon-keying id, English name, and storability. */
export interface CatalogGood {
  /** Sandbox-scoped `goodType` (= {@link EXTENDED_GOOD_TYPE_OFFSET} + the ir.json typeId). */
  readonly typeId: number;
  /** Stable machine id, verbatim from `ir.json` — ALSO the `ls_goods` icon-manifest key. */
  readonly id: string;
  /** Human English label for the HUD (e.g. `"Leather"`) — our clean-room naming. */
  readonly name: string;
  /**
   * Whether a general-goods store (HQ / warehouse) advertises a stock slot for it. True for the carried
   * wares; false for the animal/vehicle/special tokens (`prey`, `sheep`, `cattle`, the carts/ships,
   * `catapult`, `chest`, `anything`) — those are herded/driven/sentinel, not warehoused.
   */
  readonly storable: boolean;
}

/**
 * The extended goods, in ir.json typeId order. The raw typeIds live here (their definition) and nowhere
 * else — code refers to a good by id through {@link EXTENDED_GOODS} / {@link STORABLE_EXTENDED_GOODS}.
 */
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
  // fruit (118) dropped from the catalog with fish/sausage: its `goods all` record reuses bread's frames in
  // the source (no distinct fruit art), so it only ever reads as bread. Still a genuine `goodtypes.ini` good
  // in the extracted IR — an app-catalog curation, not a data change.
  { typeId: 119, id: 'bread', name: 'Bread', storable: true },
  { typeId: 120, id: 'candy', name: 'Candy', storable: true },
  { typeId: 121, id: 'meat', name: 'Meat', storable: true },
  // fish (122) + sausage (123) are dropped from the catalog on purpose: they are house-made food goods with
  // no distinct `ls_goods` art (the original's `landscapes.cif` binds both to gold's bar frames), so they only
  // ever read as gold bars. `meat` already covers "produced food"; keeping the catalog to goods with a
  // meaningful, distinguishable icon. They still exist in the extracted IR — this is an app-catalog curation.
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
  // `sword_shord` keeps the ir.json spelling (a typo in the source) so the icon key matches; the name is
  // corrected to "Short Sword".
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
  // Animal / vehicle / special tokens — real goodtypes, but herded, driven, or sentinel rather than
  // warehoused, so they carry no stock slot (and no `ls_goods` icon).
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

/** The extended wares a general-goods store advertises a stock slot for (the storable subset). */
export const STORABLE_EXTENDED_GOODS: readonly CatalogGood[] = EXTENDED_GOODS.filter((g) => g.storable);
