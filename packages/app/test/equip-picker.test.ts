import { describe, expect, it } from 'vitest';
import { equipSlotFor, selectionEquipCommands } from '../src/view/unit-controls/equip-picker.js';

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
