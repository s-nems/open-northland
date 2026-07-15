import {
  CLAY_HARVEST_ATOMIC,
  CULTIVATE_ATOMIC,
  GOLD_HARVEST_ATOMIC,
  HARVEST_ATOMIC,
  IRON_HARVEST_ATOMIC,
  MUSHROOM_HARVEST_ATOMIC,
  PLANT_ATOMIC,
  STONE_HARVEST_ATOMIC,
  WHEAT_HARVEST_ATOMIC,
} from '../../../../catalog/atomics.js';
import {
  FARM_FIELD_RADIUS,
  FARM_FIELDS_BASE,
  FARM_FIELDS_PER_FARMER,
  WHEAT_GROWTH_STAGES,
  WHEAT_TICKS_PER_STAGE,
  WHEAT_YIELD_PER_FIELD,
} from '../../../../catalog/farming.js';
import { GATHERING_BALANCE_BY_ID } from '../../../../catalog/gathering.js';
import { EXTENDED_GOODS } from '../../../../catalog/goods.js';
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

/** Build the sandbox's core goods plus the full committed catalog. */
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
      return {
        typeId: good.typeId,
        id: good.id,
        name: extras.goodNames?.get(good.id) ?? good.name,
        weight: 1,
        ...(equip !== undefined ? { equip } : {}),
        ...(good.typeId === GOOD_WHEAT
          ? {
              atomics: {
                harvest: WHEAT_HARVEST_ATOMIC,
                cultivate: CULTIVATE_ATOMIC,
                plant: PLANT_ATOMIC,
              },
              farming: {
                stages: WHEAT_GROWTH_STAGES,
                ticksPerStage: WHEAT_TICKS_PER_STAGE,
                yieldPerField: WHEAT_YIELD_PER_FIELD,
                fieldRadius: FARM_FIELD_RADIUS,
                fieldsBase: FARM_FIELDS_BASE,
                fieldsPerFarmer: FARM_FIELDS_PER_FARMER,
              },
            }
          : {}),
      };
    }),
  ];
}
