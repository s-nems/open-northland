import { components } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { VEHICLE_CART_NO_OX, VEHICLE_OXCART } from '../../src/game/sandbox/index.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { vehicleOxScene } from '../../src/scenes/vehicle-ox.js';
import { sceneAcceptance } from './scene-case.js';

sceneAcceptance(vehicleOxScene, import.meta.url);

/** The waiting cart refuses its goto with the animal note and the carrier's attach with the trade note,
 *  and is the bare type until the cow arrives, which is the tick its sprite binding changes. */
it('the goto and the attach are refused and the type changes only when the cow is consumed', () => {
  const sim = createSceneSim(vehicleOxScene);
  const { Vehicle } = components;
  const refusals: string[] = [];
  let harnessedAt = -1;
  for (let t = 1; t <= vehicleOxScene.runTicks && harnessedAt < 0; t++) {
    sim.step();
    for (const ev of sim.events.current()) {
      if (ev.kind === 'vehicleMoveRefused' || ev.kind === 'riderRefused') refusals.push(ev.reason);
    }
    const carts = [...sim.world.query(Vehicle)].map((e) => sim.world.get(e, Vehicle));
    if (carts.some((v) => v.harnessed)) {
      harnessedAt = t;
      expect(carts.map((v) => v.vehicleType)).toEqual([VEHICLE_OXCART]);
    } else {
      expect(carts.map((v) => [v.vehicleType, v.task])).toEqual([[VEHICLE_CART_NO_OX, 'waitsForAnimal']]);
    }
  }
  expect(refusals).toEqual(['noAnimal', 'cannotEnter']);
  expect(harnessedAt).toBeGreaterThan(0);
});
