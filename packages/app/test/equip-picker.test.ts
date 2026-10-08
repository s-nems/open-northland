import { components, playerCommand } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { equipmentScene } from '../src/scenes/equipment.js';
import { createSceneSim } from '../src/scenes/runtime.js';
import { goodBySlug } from '../src/scenes/sandbox-queries.js';
import { equipSlotFor, selectionEquipCommands } from '../src/view/unit-controls/equip-picker.js';

const HUMAN_SEAT = 0;
/** Enough for both fetches from the headquarters' shelf and the walks back. */
const TWO_ERRANDS_TICKS = 1500;

describe('equipSlotFor', () => {
  it('replaces fixed slots and fills the first free misc slot before replacing slot zero', () => {
    expect(equipSlotFor({}, 'weapon')).toBe(0);
    expect(equipSlotFor({ Equipment: { misc: [{}, null, {}, null] } }, 'misc')).toBe(1);
    expect(equipSlotFor({ Equipment: { misc: [{}, {}, {}, {}] } }, 'misc')).toBe(0);
  });

  it('aims a second misc pick past the slots a player errand is already filling, so it queues', () => {
    const empty = { misc: [null, null, null, null] };
    const fetching = { issuer: 'player', group: 'misc', slot: 0, queued: [{ group: 'misc', slot: 1 }] };
    expect(equipSlotFor({ Equipment: empty, EquipOrder: fetching }, 'misc')).toBe(2);
    const full = { misc: [{}, {}, {}, {}] };
    expect(equipSlotFor({ Equipment: full, EquipOrder: fetching }, 'misc')).toBe(2);
    const everySlot = { ...fetching, queued: [1, 2, 3].map((slot) => ({ group: 'misc', slot })) };
    expect(equipSlotFor({ Equipment: full, EquipOrder: everySlot }, 'misc')).toBe(0);
  });

  it('ignores an assistant hand-out, which the player order replaces', () => {
    const empty = { misc: [null, null, null, null] };
    const handOut = { issuer: 'assistant-grant', group: 'misc', slot: 0, queued: [] };
    expect(equipSlotFor({ Equipment: empty, EquipOrder: handOut }, 'misc')).toBe(0);
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

describe('two misc picks in a row', () => {
  it('queue behind each other and both end up worn', () => {
    const sim = createSceneSim(equipmentScene);
    sim.run(equipmentScene.runTicks);
    const amulet = goodBySlug(sim, 'amulet_defense');
    const potion = goodBySlug(sim, 'potion_heal_small');
    const stamina = goodBySlug(sim, 'potion_stamina_small');
    // The soldier wears one misc good and has three free misc slots.
    const soldier = [...sim.world.query(components.Equipment)].find(
      (e) => sim.world.get(e, components.Equipment).misc[0]?.goodType === stamina,
    );
    if (soldier === undefined) throw new Error('missing the scene soldier');
    for (const goodType of [amulet, potion]) {
      for (const command of selectionEquipCommands(sim.snapshot(), [soldier], { goodType, group: 'misc' })) {
        sim.enqueue(playerCommand(HUMAN_SEAT, command));
      }
      sim.step();
    }
    sim.run(TWO_ERRANDS_TICKS);
    const worn = sim.world.get(soldier, components.Equipment).misc.map((slot) => slot?.goodType ?? null);
    expect(worn).toEqual([stamina, amulet, potion, null]);
  });
});
