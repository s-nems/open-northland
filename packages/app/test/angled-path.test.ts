import { type DrawItem, buildScene } from '@vinland/render';
import { describe, expect, it } from 'vitest';
import { angledPathScene } from '../src/scenes/angled-path.js';
import { createSceneSim } from '../src/scenes/index.js';

/**
 * The angled-path scene's extra proof — beyond the generic mechanic check the scene registry already
 * runs (`scenes.test.ts`), this steps the sim tick-by-tick and feeds each snapshot through the SAME pure
 * render projection (`buildScene`) the browser uses, so the "moves at many angles" property is machine-
 * checked, not eyeballed: the worker must show several distinct isometric FACINGS (a straight line shows
 * one or two) and the loaded-carry render path must actually fire (a `carrying` draw item appears).
 */
describe('angled-path scene — pathfinding + directional animation', () => {
  it('the woodcutter snakes through the maze: many facings, and a loaded carry leg', () => {
    const sim = createSceneSim(angledPathScene);
    const facings = new Set<number>();
    let sawCarrying = false;
    const settlerOf = (items: DrawItem[]): DrawItem | undefined => items.find((d) => d.kind === 'settler');

    for (let t = 0; t < angledPathScene.runTicks; t++) {
      sim.step();
      const settler = settlerOf(buildScene(sim.snapshot(), angledPathScene.terrain));
      if (settler === undefined) continue;
      if (settler.facing !== undefined) facings.add(settler.facing);
      if (settler.carrying === true) sawCarrying = true;
    }

    // The 4-connected pathfinder projects axis-aligned legs to the four EVEN isometric facings; the snake
    // makes the worker walk in all four grid directions over the descend-empty / ascend-loaded loop, so we
    // expect all four. (A straight-line walk to a single target shows at most two.)
    expect(facings.size).toBeGreaterThanOrEqual(4);
    // The carry render path fired — the worker hauled a load (the `..._walk_wood` gait the binding swaps in).
    expect(sawCarrying).toBe(true);
  });
});
