import { components } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { BUILDING_ANIMAL_FARM } from '../../src/game/sandbox/index.js';
import { constructionScene } from '../../src/scenes/construction.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { sceneAcceptance } from './scene-case.js';

sceneAcceptance(constructionScene, import.meta.url);

it('the future breeder carries construction materials to its own animal farm', () => {
  const sim = createSceneSim(constructionScene);
  const { Building, Carrying, JobAssignment, SupplyRun, UnderConstruction } = components;
  let helped = false;
  for (let tick = 0; tick < 2000 && !helped; tick++) {
    sim.step();
    for (const e of sim.world.query(JobAssignment, Carrying, SupplyRun)) {
      const site = sim.world.get(e, JobAssignment).workplace;
      if (sim.world.tryGet(site, Building)?.buildingType !== BUILDING_ANIMAL_FARM) continue;
      helped =
        sim.world.has(site, UnderConstruction) &&
        sim.world.get(e, SupplyRun).site === site &&
        sim.world.get(e, Carrying).amount > 0;
    }
  }
  expect(helped).toBe(true);
});
