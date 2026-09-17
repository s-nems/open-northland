import { components } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { vehiclesScene } from '../../src/scenes/vehicles.js';
import { sceneAcceptance } from './scene-case.js';

sceneAcceptance(vehiclesScene, import.meta.url);

/** Past the scene's scheduled kill tick. */
const WRECK_CHECK_TICKS = 20;
/** Long enough for every commander's short walk to its door and the step inside. */
const BOARDING_TICKS = 40;

/** The wreck decals ride the `vehicleDestroyed` event's ruin nodes, which the cleanup emits the tick the
 *  scheduled kill lands. */
it('the scheduled kill wrecks the catapult with ruin nodes for the decals', () => {
  const sim = createSceneSim(vehiclesScene);
  const wrecks: { cause: string; ruins: readonly unknown[] }[] = [];
  for (let i = 0; i < WRECK_CHECK_TICKS; i++) {
    sim.step();
    for (const ev of sim.events.current()) if (ev.kind === 'vehicleDestroyed') wrecks.push(ev);
  }
  expect(wrecks).toHaveLength(1);
  expect(wrecks[0]?.cause).toBe('destroyed');
  expect(wrecks[0]?.ruins.length).toBeGreaterThan(0);
});

/** The trader, the ship's party and the two drivers all attach on the first tick: four crewed vehicles. */
it('the trader, the party and the two drivers take their commander seats', () => {
  const sim = createSceneSim(vehiclesScene);
  sim.run(1);
  const crewed = [...sim.world.query(components.Vehicle)].filter(
    (e) => components.vehicleCommander(sim.world.get(e, components.Vehicle)) !== null,
  );
  expect(crewed).toHaveLength(4);
});

/** The drive orders land and are accepted: no refusal is raised, the three ordered vehicles wait for
 *  their commanders to board and then drive. */
it('the ordered vehicles board their commanders and drive without a refusal', () => {
  const sim = createSceneSim(vehiclesScene);
  const refused: string[] = [];
  for (let i = 0; i < WRECK_CHECK_TICKS; i++) {
    sim.step();
    for (const ev of sim.events.current()) if (ev.kind === 'vehicleMoveRefused') refused.push(ev.reason);
  }
  expect(refused).toEqual([]);
  const waiting = [...sim.world.query(components.Vehicle)].filter(
    (e) => sim.world.get(e, components.Vehicle).task === 'waitsForHuman',
  );
  const driving = [...sim.world.query(components.VehicleDrive)];
  expect(waiting.length + driving.length).toBe(3);
  sim.run(BOARDING_TICKS);
  expect([...sim.world.query(components.VehicleDrive)]).toHaveLength(3);
});
