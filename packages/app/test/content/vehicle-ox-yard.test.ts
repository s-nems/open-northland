import { components } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { VEHICLE_CART_NO_OX, VEHICLE_OXCART } from '../../src/game/sandbox/index.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { vehicleOxYardScene } from '../../src/scenes/vehicle-ox-yard.js';
import { hasRealIr, loadContentUnderTest } from './helpers.js';

describe.runIf(hasRealIr())('ox cart construction on real content', () => {
  it('builds bare carts and takes one existing farm cow after its walk', { timeout: 60_000 }, async () => {
    const { merge } = await loadContentUnderTest();
    const sim = createSceneSim(vehicleOxYardScene, { content: merge.content });
    const { DraughtAnimal, Livestock, Vehicle } = components;
    const launches: number[] = [];
    let walkingTicks = 0;
    for (let tick = 0; tick < vehicleOxYardScene.runTicks; tick++) {
      sim.step();
      for (const event of sim.events.current()) {
        if (event.kind === 'vehicleCreated') launches.push(event.vehicleType);
      }
      for (const animal of sim.world.query(DraughtAnimal)) {
        expect(sim.world.get(sim.world.get(animal, DraughtAnimal).vehicle, Vehicle).vehicleType).toBe(
          VEHICLE_CART_NO_OX,
        );
        walkingTicks++;
      }
      if (walkingTicks === 0) {
        expect(sim.vehiclesOf(0).some((v) => v.vehicleType === VEHICLE_OXCART)).toBe(false);
      }
    }
    expect(launches).toEqual([VEHICLE_CART_NO_OX, VEHICLE_CART_NO_OX]);
    expect(walkingTicks).toBeGreaterThan(1);
    expect([...sim.world.query(Livestock)]).toHaveLength(4);
    for (const check of vehicleOxYardScene.checks) expect(check.predicate(sim), check.label).toBe(true);
  });
});
