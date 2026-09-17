import { components } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { BUILDING_HANDCART_YARD, VEHICLE_HANDCART } from '../../src/game/sandbox/index.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { vehicleYardScene } from '../../src/scenes/vehicle-yard.js';
import { sceneAcceptance } from './scene-case.js';

sceneAcceptance(vehicleYardScene, import.meta.url);

/** The yard is a real construction site until it launches: the joiner's crew membership on it is what the
 *  builder-style rungs read, and the site leaves the world the tick the cart appears. */
it('a yard site stands beside the joinery before the first cart and is gone once it launched', () => {
  const sim = createSceneSim(vehicleYardScene);
  const { Building, SiteAssignment, UnderConstruction, Vehicle } = components;
  let sawSite = false;
  let sawCrew = false;
  let launchedAt = -1;
  for (let t = 1; t <= vehicleYardScene.runTicks && launchedAt < 0; t++) {
    sim.step();
    for (const e of sim.world.query(Building, UnderConstruction)) {
      if (sim.world.get(e, Building).buildingType !== BUILDING_HANDCART_YARD) continue;
      sawSite = true;
      for (const w of sim.world.query(SiteAssignment))
        if (sim.world.get(w, SiteAssignment).site === e) sawCrew = true;
    }
    for (const ev of sim.events.current()) {
      if (ev.kind === 'vehicleCreated' && ev.vehicleType === VEHICLE_HANDCART) launchedAt = t;
    }
  }
  expect(sawSite).toBe(true);
  expect(sawCrew).toBe(true);
  expect(launchedAt).toBeGreaterThan(0);
  const carts = [...sim.world.query(Vehicle)].filter(
    (e) => sim.world.get(e, Vehicle).vehicleType === VEHICLE_HANDCART,
  );
  expect(carts).toHaveLength(1);
});
