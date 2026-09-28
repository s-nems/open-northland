import { components } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { creatureFormsScene } from '../../src/scenes/creature-forms.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { sceneAcceptance } from './scene-case.js';

sceneAcceptance(creatureFormsScene, import.meta.url);

it('places each weresnake form at its authored job id', () => {
  const sim = createSceneSim(creatureFormsScene);
  sim.step();
  const jobs = [...sim.world.query(components.Settler)]
    .map((entity) => sim.world.get(entity, components.Settler))
    .filter((settler) => settler.tribe === 5)
    .map((settler) => settler.jobType)
    .filter((job): job is number => job !== null)
    .sort((a, b) => a - b);
  expect(jobs).toEqual([16, 18, 32, 33, 35]);
});
