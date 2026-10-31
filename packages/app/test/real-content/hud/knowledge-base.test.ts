import { describe, expect, it } from 'vitest';
import { createKnowledgeBase } from '../../../src/hud/knowledge/base.js';
import { rawCost } from '../../../src/hud/knowledge/chains.js';
import { combatTargets } from '../../../src/hud/knowledge/combat.js';
import { checkLanes } from '../../../src/hud/knowledge/lanes.js';
import { hasRealIr, loadContentUnderTest } from '../helpers.js';

describe.runIf(hasRealIr())('the knowledge base over the decoded content', () => {
  it('agrees with every authored lane', async () => {
    const { merge } = await loadContentUnderTest();
    expect(checkLanes(createKnowledgeBase(merge.content))).toEqual([]);
  });

  it('reads the same off the decoded rows as off the merged ones', async () => {
    const { real, merge } = await loadContentUnderTest();
    const decoded = createKnowledgeBase(real);
    const merged = createKnowledgeBase(merge.content);
    expect(decoded.goods.map((g) => g.equip)).toEqual(merged.goods.map((g) => g.equip));
    expect(decoded.goods.map((g) => g.gathering)).toEqual(merged.goods.map((g) => g.gathering));
    expect(decoded.buildings.map((b) => b.shelterCapacity)).toEqual(
      merged.buildings.map((b) => b.shelterCapacity),
    );
    expect(decoded.weapons).toEqual(merged.weapons);
  });

  it('leaves no recipe or cost naming a good the reference cannot show', async () => {
    const { merge } = await loadContentUnderTest();
    const base = createKnowledgeBase(merge.content);
    const unshown = base.buildings
      .flatMap((b) => [...b.cost, ...b.recipes.flatMap((r) => [...r.inputs, ...r.outputs])])
      .filter((row) => !base.goodByType.has(row.goodType));
    expect(unshown).toEqual([]);
  });

  it('resolves every good down to raw goods the reference shows', async () => {
    const { merge } = await loadContentUnderTest();
    const base = createKnowledgeBase(merge.content);
    for (const good of base.goods) {
      for (const type of rawCost(base, good.typeId).keys()) expect(base.goodByType.has(type)).toBe(true);
    }
  });

  it('fields armour columns with their real blocking', async () => {
    const { merge } = await loadContentUnderTest();
    const base = createKnowledgeBase(merge.content);
    const armoured = combatTargets(base).filter((t) => t.good !== null);
    expect(armoured).toHaveLength(base.armor.length);
    for (const target of armoured) expect(target.blocking).toBeGreaterThan(0);
  });
});
