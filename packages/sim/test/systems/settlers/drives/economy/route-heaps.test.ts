import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  JobAssignment,
  Owner,
  Position,
  Stockpile,
} from '../../../../../src/components/index.js';
import type { Entity } from '../../../../../src/ecs/world.js';
import { fx, ONE, playerCommand, Simulation } from '../../../../../src/index.js';
import { isLoosePile } from '../../../../../src/systems/stores/index.js';
import { createVehicle } from '../../../../../src/systems/vehicles/index.js';
import { testContent } from '../../../../fixtures/content.js';
import { ctxOf } from '../../../../fixtures/context.js';
import { grassCellMap } from '../../../../fixtures/terrain.js';

const PLAYER = 0;
const VIKING = 1;
const HEADQUARTERS = 1;
const WOOD = 1;
const CARRIER = 24;
const TRADER = 25;
const HANDCART = 1;
/** The source stop and the stop the route fills, on one strip within the source porter's collect reach. */
const SOURCE_X = 1;
const FILLED_X = 7;
const ROW = 1;
const SOURCE_WOOD = 15;
/** Where the trader's handcart stands, in half-cell nodes beside the source. */
const CART_AT = { x: 2, y: 0 };
/** The fixture store's wood shelf: the filled stop starts full, so the trader heaps by its door. */
const FULL_SHELF = 150;
/** Long enough for the trader to empty the source and the porter to walk the strip several times. */
const RUN_TICKS = 6000;

function store(sim: Simulation, x: number, wood: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(ROW) });
  sim.world.add(e, Building, { buildingType: HEADQUARTERS, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Stockpile, { amounts: new Map([[WOOD, wood]]) });
  sim.world.add(e, Owner, { player: PLAYER });
  return e;
}

function person(sim: Simulation, x: number, jobType: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(ROW) });
  const calm = fx.fromInt(0);
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType,
    hunger: calm,
    fatigue: calm,
    piety: calm,
    enjoyment: calm,
  });
  sim.world.add(e, Owner, { player: PLAYER });
  return e;
}

describe('a porter at a trade stop', () => {
  it('leaves the heap by the door of the stop its route fills, rather than bring it back for the route', () => {
    const sim = new Simulation({ seed: 3, content: testContent(), map: grassCellMap(10, 3) });
    sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
    const source = store(sim, SOURCE_X, SOURCE_WOOD);
    const filled = store(sim, FILLED_X, FULL_SHELF);
    const trader = person(sim, SOURCE_X, TRADER);
    const cart = createVehicle(sim.world, ctxOf(sim), {
      vehicleType: HANDCART,
      ...CART_AT,
      tribe: VIKING,
      owner: PLAYER,
    });
    if (cart === null) throw new Error('setup: no handcart');
    sim.world.add(person(sim, FILLED_X, CARRIER), JobAssignment, { workplace: source });
    sim.enqueue(playerCommand(PLAYER, { kind: 'attachToVehicle', entity: trader, vehicle: cart }));
    sim.enqueue(playerCommand(PLAYER, { kind: 'attachTradeHouse', entity: trader, house: source }));
    sim.enqueue(playerCommand(PLAYER, { kind: 'attachTradeHouse', entity: trader, house: filled }));
    sim.enqueue(
      playerCommand(PLAYER, { kind: 'setTradeImport', entity: trader, house: filled, good: WOOD, on: true }),
    );

    const woodAt = (e: Entity): number => sim.world.get(e, Stockpile).amounts.get(WOOD) ?? 0;
    let returned = 0;
    let before = woodAt(source);
    for (let t = 0; t < RUN_TICKS; t++) {
      sim.step();
      returned += Math.max(0, woodAt(source) - before);
      before = woodAt(source);
    }
    let heaped = 0;
    for (const e of sim.world.query(Stockpile))
      if (isLoosePile(sim.world, e)) heaped += sim.world.get(e, Stockpile).amounts.get(WOOD) ?? 0;
    expect(returned).toBe(0);
    expect(heaped).toBe(SOURCE_WOOD);
  });
});
