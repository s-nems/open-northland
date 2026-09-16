import type { EquipCategory } from '@open-northland/data';
import type { EquipPickEntry } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { sandboxContent } from '../src/game/sandbox/index.js';
import {
  commonEquipPicks,
  equipSlotFor,
  selectionEquipCommands,
} from '../src/view/unit-controls/equip-picker.js';

describe('commonEquipPicks', () => {
  it('keeps only goods every selected settler can wear and reach, in content order', () => {
    const content = sandboxContent();
    const weapon = content.goods.find((good) => good.equip?.category === 'weapon');
    const armor = content.goods.find((good) => good.equip?.category === 'armor');
    const misc = content.goods.find((good) => good.equip?.category === 'misc');
    if (weapon === undefined || armor === undefined || misc === undefined) {
      throw new Error('sandbox must carry weapon, armor and misc equipment');
    }
    const rows = new Map<number, ReadonlyMap<EquipCategory, readonly EquipPickEntry[]>>([
      [
        4,
        new Map([
          ['weapon', [{ goodType: weapon.typeId, available: 3 }]],
          ['armor', [{ goodType: armor.typeId, available: 2 }]],
          ['misc', [{ goodType: misc.typeId, available: 5 }]],
        ]),
      ],
      [9, new Map([['misc', [{ goodType: misc.typeId, available: 4 }]]])],
    ]);
    const pickList = (entity: number, group: EquipCategory): readonly EquipPickEntry[] =>
      rows.get(entity)?.get(group) ?? [];

    expect(commonEquipPicks(content, [4, 9], pickList)).toEqual([
      { goodType: misc.typeId, group: 'misc', available: 4 },
    ]);
    expect(commonEquipPicks(content, [4], pickList)).toEqual(
      content.goods
        .filter((good) => [weapon.typeId, armor.typeId, misc.typeId].includes(good.typeId))
        .map((good) => ({
          goodType: good.typeId,
          group: good.equip?.category,
          available: rows.get(4)?.get(good.equip?.category ?? 'misc')?.[0]?.available,
        })),
    );
  });
});

describe('equipSlotFor', () => {
  it('replaces fixed slots and fills the first free misc slot before replacing slot zero', () => {
    expect(equipSlotFor({}, 'weapon')).toBe(0);
    expect(equipSlotFor({ Equipment: { misc: [{}, null, {}, null] } }, 'misc')).toBe(1);
    expect(equipSlotFor({ Equipment: { misc: [{}, {}, {}, {}] } }, 'misc')).toBe(0);
  });
});

describe('selectionEquipCommands', () => {
  it('issues the picked good to every live selected settler and chooses each misc slot independently', () => {
    const snapshot = {
      tick: 1,
      events: [],
      entities: [
        { id: 4, components: { Equipment: { misc: [{}, null, null, null] } } },
        { id: 9, components: { Equipment: { misc: [{}, {}, {}, {}] } } },
      ],
    };

    expect(selectionEquipCommands(snapshot, [4, 9, 12], { goodType: 55, group: 'misc' })).toEqual([
      { kind: 'equipGood', entity: 4, group: 'misc', slot: 1, goodType: 55 },
      { kind: 'equipGood', entity: 9, group: 'misc', slot: 0, goodType: 55 },
    ]);
  });
});
