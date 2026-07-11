import { components } from '@vinland/sim';
import { expect, it } from 'vitest';
import { createSceneSim, SCENES } from '../src/scenes/index.js';

/**
 * The battle scene's MUSTER guard: every spawn command must actually land (the spawn handler
 * silently skips a jobType missing from the content set, and the scene's end-state casualty check
 * cannot tell "died fighting" from "never spawned" — this test closes that hole by counting the
 * army right after spawn, before any fighting).
 */
it('the battle scene musters its full 200 fighters, 50 per weapon class', () => {
  const scene = SCENES.find((s) => s.id === 'battle');
  expect(scene).toBeDefined();
  if (scene === undefined) return;
  const sim = createSceneSim(scene);
  sim.run(2); // tick 1 drains the spawn commands; tick 2 proves nothing reaps them
  const byJob = new Map<number | null, number>();
  for (const e of sim.world.query(components.Settler)) {
    const j = sim.world.get(e, components.Settler).jobType;
    byJob.set(j, (byJob.get(j) ?? 0) + 1);
  }
  const total = [...byJob.values()].reduce((a, b) => a + b, 0);
  expect(total).toBe(200);
  for (const [job, count] of byJob) {
    expect(count, `job ${job}`).toBe(50);
  }
});
