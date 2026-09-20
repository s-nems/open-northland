import {
  CLAY_HARVEST_ATOMIC,
  CULTIVATE_ATOMIC,
  GOLD_HARVEST_ATOMIC,
  HARVEST_ATOMIC,
  HARVEST_CADAVER_ATOMIC,
  IRON_HARVEST_ATOMIC,
  MUSHROOM_HARVEST_ATOMIC,
  PLANT_ATOMIC,
  STONE_HARVEST_ATOMIC,
  WHEAT_HARVEST_ATOMIC,
} from '../../../../catalog/atomics.js';
import { FARMING_BALANCE_BY_ID } from '../../../../catalog/farming.js';
import { GATHERING_BALANCE_BY_ID } from '../../../../catalog/gathering.js';
import { EXTENDED_GOODS, PRODUCE_ATOMIC_BY_GOOD_ID } from '../../../../catalog/goods.js';
import { CARCASS_GOOD_SLUGS } from '../../../../catalog/hunting.js';
import { EQUIP_CLASS_BY_TYPE } from '../../combat.js';
import {
  GOOD_COIN,
  GOOD_GOLD,
  GOOD_IRON,
  GOOD_MUD,
  GOOD_MUSHROOM,
  GOOD_NONE,
  GOOD_PLANK,
  GOOD_STONE,
  GOOD_WHEAT,
  GOOD_WOOD,
} from '../../ids/index.js';
import type { SandboxContentExtras } from '../types.js';

export function buildSandboxGoods(extras: SandboxContentExtras): readonly object[] {
  const localName = (id: string): { name?: string } => {
    const name = extras.goodNames?.get(id);
    return name !== undefined ? { name } : {};
  };

  return [
    { typeId: GOOD_NONE, id: 'none' },
    {
      typeId: GOOD_WOOD,
      id: 'wood',
      ...localName('wood'),
      weight: 1,
      atomics: { harvest: HARVEST_ATOMIC },
      gathering: GATHERING_BALANCE_BY_ID.wood,
    },
    { typeId: GOOD_PLANK, id: 'plank', ...localName('plank'), weight: 1 },
    { typeId: GOOD_COIN, id: 'coin', ...localName('coin') },
    {
      typeId: GOOD_STONE,
      id: 'stone',
      ...localName('stone'),
      weight: 1,
      atomics: { harvest: STONE_HARVEST_ATOMIC },
      gathering: GATHERING_BALANCE_BY_ID.stone,
    },
    {
      typeId: GOOD_MUD,
      id: 'mud',
      ...localName('mud'),
      weight: 1,
      atomics: { harvest: CLAY_HARVEST_ATOMIC },
      gathering: GATHERING_BALANCE_BY_ID.mud,
    },
    {
      typeId: GOOD_IRON,
      id: 'iron',
      ...localName('iron'),
      weight: 1,
      atomics: { harvest: IRON_HARVEST_ATOMIC },
      gathering: GATHERING_BALANCE_BY_ID.iron,
    },
    {
      typeId: GOOD_GOLD,
      id: 'gold',
      ...localName('gold'),
      weight: 1,
      atomics: { harvest: GOLD_HARVEST_ATOMIC },
      gathering: GATHERING_BALANCE_BY_ID.gold,
    },
    {
      typeId: GOOD_MUSHROOM,
      id: 'mushroom',
      ...localName('mushroom'),
      weight: 1,
      atomics: { harvest: MUSHROOM_HARVEST_ATOMIC },
      gathering: GATHERING_BALANCE_BY_ID.mushroom,
    },
    ...EXTENDED_GOODS.map((good) => {
      const equip = EQUIP_CLASS_BY_TYPE.get(good.typeId);
      // The extracted leather/meat rows carry this harvest atomic; wool's is a named approximation.
      const carcassGood = (CARCASS_GOOD_SLUGS as readonly string[]).includes(good.id);
      const produce = PRODUCE_ATOMIC_BY_GOOD_ID[good.id];
      const atomics = {
        ...(carcassGood ? { harvest: HARVEST_CADAVER_ATOMIC } : {}),
        ...(good.typeId === GOOD_WHEAT
          ? { harvest: WHEAT_HARVEST_ATOMIC, cultivate: CULTIVATE_ATOMIC, plant: PLANT_ATOMIC }
          : {}),
        ...(produce !== undefined ? { produce } : {}),
      };
      return {
        typeId: good.typeId,
        id: good.id,
        name: extras.goodNames?.get(good.id) ?? good.name,
        weight: 1,
        ...(equip !== undefined ? { equip } : {}),
        ...(good.homeQuality !== undefined ? { homeQuality: good.homeQuality } : {}),
        ...(Object.keys(atomics).length > 0 ? { atomics } : {}),
        ...(good.typeId === GOOD_WHEAT ? { farming: FARMING_BALANCE_BY_ID.wheat } : {}),
      };
    }),
  ];
}
