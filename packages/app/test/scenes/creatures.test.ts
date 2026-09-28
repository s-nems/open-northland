import { components } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { creaturesScene } from '../../src/scenes/creatures.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { sceneAcceptance } from './scene-case.js';

sceneAcceptance(creaturesScene, import.meta.url);

it('places both monster tribes and all five dangerous animal species', () => {
  const sim = createSceneSim(creaturesScene);
  sim.step();
  const counts = new Map<number, number>();
  for (const e of sim.world.query(components.Settler, components.Health)) {
    const tribe = sim.world.get(e, components.Settler).tribe;
    counts.set(tribe, (counts.get(tribe) ?? 0) + 1);
  }
  expect([...counts].sort(([a], [b]) => a - b)).toEqual([
    [1, 4],
    [5, 1],
    [6, 1],
    [8, 2],
    [18, 2],
    [20, 2],
    [25, 2],
    [26, 2],
  ]);
});
