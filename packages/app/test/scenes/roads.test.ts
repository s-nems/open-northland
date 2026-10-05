import { components } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { JOB_CARRIER } from '../../src/catalog/jobs.js';
import { ROADS_RUN_TICKS, roadsScene } from '../../src/scenes/roads.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { sceneAcceptance } from './scene-case.js';

const { CurrentAtomic, RoadSite, Settler } = components;

sceneAcceptance(roadsScene, import.meta.url);

it("never sends the store's carrier to lift a road site's delivered stone", () => {
  const sim = createSceneSim(roadsScene);
  const carriers = [...sim.world.query(Settler)].filter(
    (e) => sim.world.get(e, Settler).jobType === JOB_CARRIER,
  );
  expect(carriers).toHaveLength(1);
  const [carrier] = carriers;
  const sitePickups: number[] = [];
  for (let tick = 0; tick < ROADS_RUN_TICKS; tick++) {
    sim.step();
    const effect = carrier === undefined ? undefined : sim.world.tryGet(carrier, CurrentAtomic)?.effect;
    if (effect?.kind === 'pickup' && effect.from !== null && sim.world.has(effect.from, RoadSite))
      sitePickups.push(sim.tick);
  }
  expect(sitePickups).toEqual([]);
});
