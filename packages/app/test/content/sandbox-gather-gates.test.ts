import { components } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { GOOD_GOLD, GOOD_IRON } from '../../src/game/sandbox/index.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { sandboxScene } from '../../src/scenes/sandbox/index.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

const { Resource } = components;

/** Total units still standing in `good`'s resource nodes. */
function remaining(sim: ReturnType<typeof createSceneSim>, good: number): number {
  let total = 0;
  for (const e of sim.world.query(Resource)) {
    const r = sim.world.get(e, Resource);
    if (r.goodType === good) total += r.remaining;
  }
  return total;
}

/**
 * Real content gates iron/gold harvesting behind clay/stone-digging XP (`needforgood 6/7 10` over the
 * collector's mud/stone tracks) — a gate the synthetic sandbox content doesn't carry, so only this
 * real-content twin can prove the sandbox camps still work under it. The scene's collectors spawn as
 * veterans (`gatherMasteryExperience`); without that stamp a fresh collector pinned to an iron camp
 * fails `settlerMeetsNeed` forever and stands idle beside its deposit (the 2026-07-16 regression).
 */
describe.runIf(hasRealIr())('sandbox scene on real content — gathering XP gates', () => {
  it('the iron and gold camps are actually mined (veteran collectors pass needforgood)', async () => {
    const { merge } = await loadContentUnderTest();
    const sim = createSceneSim(sandboxScene, undefined, merge.content);
    const iron = remaining(sim, GOOD_IRON);
    const gold = remaining(sim, GOOD_GOLD);
    sim.run(3600); // 5 min of game time at 1× — several dig cycles per camp
    expect(remaining(sim, GOOD_IRON)).toBeLessThan(iron);
    expect(remaining(sim, GOOD_GOLD)).toBeLessThan(gold);
    // A 3600-tick real-content run is tens of seconds alone; the budget is a hang-guard sized for a
    // CPU-contended full parallel run (observed timing out at 120s under multi-session machine load).
  }, 300_000);
});
