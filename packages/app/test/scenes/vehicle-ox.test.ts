import { components, playerCommand } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { JOB_TRADER } from '../../src/catalog/jobs.js';
import { spawnSettlerDirect, VEHICLE_CART_NO_OX, VEHICLE_OXCART } from '../../src/game/sandbox/index.js';
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

it('refuses a trader until the cow arrives, then accepts the same trader', () => {
  const sim = createSceneSim(vehicleOxScene);
  const { Position, Rider, Vehicle, VehicleDrive } = components;
  const trader = spawnSettlerDirect(sim, JOB_TRADER, 7, 7);
  const [cart] = sim.world.query(Vehicle);
  if (cart === undefined) throw new Error('missing cart');
  const position = { ...sim.world.get(cart, Position) };
  const attach = playerCommand(0, { kind: 'attachToVehicle', entity: trader, vehicle: cart });
  expect(sim.canAttachToVehicle(trader, cart)).toBe(false);
  sim.enqueue(attach);
  sim.enqueue(playerCommand(0, { kind: 'moveVehicle', vehicle: cart, x: 24, y: 20 }));
  sim.step();
  expect(sim.events.current()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'riderRefused', entity: trader, reason: 'cannotEnter' }),
      expect.objectContaining({ kind: 'vehicleMoveRefused', entity: cart, reason: 'noAnimal' }),
    ]),
  );
  expect(sim.world.has(trader, Rider)).toBe(false);
  expect(sim.world.has(cart, VehicleDrive)).toBe(false);
  expect(sim.world.get(cart, Position)).toEqual(position);
  while (sim.tick < vehicleOxScene.runTicks && !sim.world.get(cart, Vehicle).harnessed) sim.step();
  expect(sim.world.get(cart, Vehicle).vehicleType).toBe(VEHICLE_OXCART);
  expect(sim.canAttachToVehicle(trader, cart)).toBe(true);
  sim.enqueue(attach);
  sim.step();
  expect(sim.world.get(trader, Rider).vehicle).toBe(cart);
});
