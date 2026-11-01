import { describe, expect, it } from 'vitest';
import { createKnowledgeBase } from '../../../src/hud/knowledge/base.js';
import { recipeTicks } from '../../../src/hud/knowledge/chains.js';
import { listedJobs } from '../../../src/hud/knowledge/entry-blocks.js';
import { hasRealIr, loadContentUnderTest } from '../helpers.js';

const VIKING = 1;
const BYZANTINE = 3;
const WOODEN_SPEAR = 'wooden_spear';

describe.runIf(hasRealIr())('the numbers the Knowledge window reads', () => {
  it('times each batch by its produce clip, not the row stand-in', async () => {
    const { merge } = await loadContentUnderTest();
    const base = createKnowledgeBase(merge.content);
    const times = base.buildings.flatMap((building) =>
      building.recipes.map((recipe) => recipeTicks(base, building, recipe, VIKING)),
    );
    expect(new Set(times).size).toBeGreaterThan(2);
  });

  it('gives a trained Byzantine wooden spearman the Viking spear, not the dragon row', async () => {
    const { merge } = await loadContentUnderTest();
    const base = createKnowledgeBase(merge.content);
    const spear = (tribe: number) => base.weapons.get(tribe)?.find((w) => w.id === WOODEN_SPEAR);
    expect(spear(BYZANTINE)?.damage).toEqual(spear(VIKING)?.damage);
    expect(spear(BYZANTINE)?.maxRange).toBe(spear(VIKING)?.maxRange);
    expect(spear(BYZANTINE)?.filmJob).not.toBe(spear(BYZANTINE)?.jobType);
  });

  it('lists one soldier, no hero and no woman among the trades', async () => {
    const { merge } = await loadContentUnderTest();
    const ids = listedJobs(createKnowledgeBase(merge.content)).map((job) => job.id);
    expect(ids.filter((id) => id.startsWith('soldier'))).toEqual(['soldier_unarmed']);
    expect(ids.filter((id) => id.startsWith('hero') || id === 'woman')).toEqual([]);
  });
});
