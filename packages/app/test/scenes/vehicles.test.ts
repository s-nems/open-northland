import { components } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { vehiclesScene } from '../../src/scenes/vehicles.js';
import { sceneAcceptance } from './scene-case.js';

sceneAcceptance(vehiclesScene, import.meta.url);

/** Past the scene's scheduled kill tick. */
const WRECK_CHECK_TICKS = 20;

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

/** The trader seated in the handcart keeps its seat, the seam the crew gait reads, and the two ordered
 *  drivers keep theirs, so the drive orders are never refused. */
it('the trader crews the viking handcart and the two drivers keep their commanders', () => {
  const sim = createSceneSim(vehiclesScene);
  sim.run(1);
  const crewed = [...sim.world.query(components.Vehicle)].filter(
    (e) => components.vehicleCommander(sim.world.get(e, components.Vehicle)) !== null,
  );
  expect(crewed).toHaveLength(3);
});

/** The drive orders land and are accepted: no refusal is raised while both drives run. */
it('the ordered ox cart and catapult drive without a refusal', () => {
  const sim = createSceneSim(vehiclesScene);
  const refused: string[] = [];
  for (let i = 0; i < WRECK_CHECK_TICKS; i++) {
    sim.step();
    for (const ev of sim.events.current()) if (ev.kind === 'vehicleMoveRefused') refused.push(ev.reason);
  }
  expect(refused).toEqual([]);
  const driving = [...sim.world.query(components.VehicleDrive)];
  expect(driving).toHaveLength(2);
});
