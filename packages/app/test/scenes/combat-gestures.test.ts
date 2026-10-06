import { combatGesturesScene } from '../../src/scenes/combat-gestures.js';
import { sceneAcceptance } from './scene-case.js';

sceneAcceptance(combatGesturesScene, import.meta.url);

import { components } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { createSceneSim } from '../../src/scenes/runtime.js';

it('reaches civilian combat, shortbow meals and sleep, and wedding celebration through ordinary orders', () => {
  const sim = createSceneSim(combatGesturesScene);
  const reached = new Set<string>();
  for (let tick = 0; tick < 300; tick++) {
    sim.step();
    for (const e of sim.world.query(components.Settler, components.CurrentAtomic)) {
      const job = sim.world.get(e, components.Settler).jobType;
      const action = sim.world.get(e, components.CurrentAtomic).atomicId;
      if (job === 6 && action === 81) expect(sim.world.has(e, components.Weapon)).toBe(false);
      reached.add(`${job}:${action}`);
    }
  }
  for (const action of ['6:81', '31:81', '40:10', '40:8', '6:17'])
    expect(reached.has(action), action).toBe(true);
});
