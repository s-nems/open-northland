import { components } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { VEHICLE_CART_NO_OX, VEHICLE_OXCART } from '../../src/game/sandbox/index.js';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { vehicleOxYardScene } from '../../src/scenes/vehicle-ox-yard.js';
import { sceneAcceptance } from './scene-case.js';

sceneAcceptance(vehicleOxYardScene, import.meta.url);

it('launches bare carts and transforms one only after its farm animal walks to it', () => {
  const sim = createSceneSim(vehicleOxYardScene);
  const { DraughtAnimal, Livestock, Position, Vehicle } = components;
  const launches: number[] = [];
  let walkingTicks = 0;
  let transformed = false;
  for (let tick = 0; tick < vehicleOxYardScene.runTicks; tick++) {
    sim.step();
    for (const event of sim.events.current()) {
      if (event.kind === 'vehicleCreated') launches.push(event.vehicleType);
    }
    for (const animal of sim.world.query(DraughtAnimal, Position)) {
      const cart = sim.world.get(animal, DraughtAnimal).vehicle;
      expect(sim.world.get(cart, Vehicle).vehicleType).toBe(VEHICLE_CART_NO_OX);
      expect([...sim.world.query(Livestock)]).toHaveLength(5);
      walkingTicks++;
    }
    if (sim.vehiclesOf(0).some((v) => v.vehicleType === VEHICLE_OXCART)) {
      expect(walkingTicks).toBeGreaterThan(1);
      expect([...sim.world.query(Livestock)]).toHaveLength(4);
      transformed = true;
      break;
    }
  }
  expect(transformed).toBe(true);
  expect(launches.length).toBeGreaterThan(0);
  expect(launches.every((type) => type === VEHICLE_CART_NO_OX)).toBe(true);
});
