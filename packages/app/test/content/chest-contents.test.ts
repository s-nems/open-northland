import { components, Simulation, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

const WOODEN_CHEST_LOGIC_TYPE = 85;
const MAGICAL_CHEST_LOGIC_TYPE = 86;

const { CHEST_CONTENTS, createChest, resolveChestReward } = systems;
const { Chest, ResourceFootprint } = components;
const CHEST_KIND_BY_LOGIC_TYPE = [
  ['wooden', WOODEN_CHEST_LOGIC_TYPE],
  ['magical', MAGICAL_CHEST_LOGIC_TYPE],
] as const;

/**
 * Pin the chest-contents table against the real extracted content. The sim opens a chest empty when a
 * reward's slug is unknown, so a typo turns a treasure into nothing with no symptom - every slug the
 * table names must resolve, and the chest landscape records must be there for a map to draw and block
 * by them.
 */
describe.runIf(hasRealIr())('chest contents against real content', () => {
  it('every reward slug and animal tribe resolves, so no known chest type opens empty', async () => {
    const { merge } = await loadContentUnderTest();
    const content = merge.content;
    for (const [type, reward] of CHEST_CONTENTS) {
      if (reward.kind === 'vehicle') continue; // the catapult chest is a named gap
      for (const kind of ['wooden', 'magical'] as const) {
        expect(resolveChestReward(content, kind, type).kind, `chest type ${type} (${kind})`).not.toBe(
          'nothing',
        );
      }
    }
  });

  it('the sim resolves each kind to its record, so a map chest draws and blocks by that record', async () => {
    const { merge } = await loadContentUnderTest();
    const content = merge.content;
    const sim = new Simulation({ seed: 1, content });
    for (const [kind, logicType] of CHEST_KIND_BY_LOGIC_TYPE) {
      const record = content.landscapeGfx.find((g) => g.logicType === logicType);
      if (record === undefined) throw new Error(`no ${kind} chest record`);
      const e = createChest(sim.world, content, { kind, contents: 0, x: 4, y: 4, gfxIndex: record.index });
      expect(sim.world.get(e, Chest).gfxIndex, kind).toBe(record.index);
      expect(sim.world.get(e, ResourceFootprint).sourceGfxIndex, kind).toBe(record.index);
      expect(sim.world.get(e, ResourceFootprint).walk.length, kind).toBeGreaterThan(0);
    }
  });
});
