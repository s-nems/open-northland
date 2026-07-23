import { components } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { equipmentScene } from '../../src/scenes/equipment.js';
import { createSceneSim } from '../../src/scenes/index.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

/**
 * The equip errand over REAL content - the join the sandbox suites cannot prove: real good ids (mead
 * is 43, not the sandbox 143), the merge's `equip` overlay feeding the order validation, and the real
 * extracted HQ footprint not burying the scene's gear piles (a pile inside a building's walls is
 * unreachable to the fetch - the regression that motivated this test).
 */

const ERRAND_TICKS = 900;

describe.runIf(hasRealIr())('equip errand on real content', () => {
  it('a soldier ordered mead fetches it from a yard pile and wears it', { timeout: 30_000 }, async () => {
    const { merge } = await loadContentUnderTest();
    const sim = createSceneSim(equipmentScene, { content: merge.content });
    sim.run(equipmentScene.runTicks);
    const soldier = [...sim.world.query(components.Equipment)].find(
      (e) => sim.world.get(e, components.Equipment).weapon !== null,
    );
    if (soldier === undefined) throw new Error('equipment scene did not place the soldier');
    const mead = sim.content.goods.find((g) => g.id === 'mead');
    if (mead?.equip === undefined) throw new Error('merged real content lost the mead equip overlay');
    expect(sim.equipPickList(soldier, 'misc')).toContainEqual({ goodType: mead.typeId, available: 2 });

    sim.enqueue({ kind: 'equipGood', entity: soldier, group: 'misc', slot: 1, goodType: mead.typeId });
    sim.run(ERRAND_TICKS);

    expect(sim.world.get(soldier, components.Equipment).misc[1]?.goodType).toBe(mead.typeId);
    expect(sim.world.has(soldier, components.EquipOrder)).toBe(false);
  });
});
