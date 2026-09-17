import { components } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { createSceneSim } from '../../src/scenes/runtime.js';
import { vehicleShipsScene } from '../../src/scenes/vehicle-ships.js';
import { sceneAcceptance } from './scene-case.js';

sceneAcceptance(vehicleShipsScene, import.meta.url);

/** Past the dock order: the ship holds the point under `docks` while the party walks to its mooring. */
const HELD_CHECK_TICKS = 6;

it('the dock order is held while the party boards at the west mooring', () => {
  const sim = createSceneSim(vehicleShipsScene);
  sim.run(HELD_CHECK_TICKS);
  const [ship] = [...sim.world.query(components.Vehicle)];
  if (ship === undefined) throw new Error('no ship');
  const state = sim.world.get(ship, components.Vehicle);
  expect(state.task).toBe('docks');
  expect(state.heldGoal).not.toBeNull();
  expect(state.moored).toBe(true);
  expect(components.vehiclePassengers(state)).toHaveLength(3);
});

it('the ship casts off once the party is aboard and reaches the far shore moored, with no refusal', () => {
  const sim = createSceneSim(vehicleShipsScene);
  const refused: string[] = [];
  let castOff = -1;
  let docked = -1;
  for (let tick = 1; tick <= vehicleShipsScene.runTicks; tick++) {
    sim.step();
    for (const ev of sim.events.current()) {
      if (ev.kind === 'vehicleMoveRefused' || ev.kind === 'riderRefused') refused.push(ev.kind);
      if (ev.kind === 'vehicleDocked') docked = tick;
    }
    const [ship] = [...sim.world.query(components.Vehicle)];
    if (ship !== undefined && castOff < 0 && !sim.world.get(ship, components.Vehicle).moored) castOff = tick;
  }
  expect(refused).toEqual([]);
  expect(castOff).toBeGreaterThan(0);
  expect(docked).toBeGreaterThan(castOff);
});
