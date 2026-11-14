import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Health } from '../../../src/components/index.js';
import { TICKS_PER_SECOND } from '../../../src/core/loop.js';
import type { Entity } from '../../../src/ecs/world.js';
import { halfCellMapFromCells, Simulation } from '../../../src/index.js';
import {
  SHIP_FIRE_DAMAGE_PER_SECOND,
  SHIP_FIRE_HEALTH_PERCENT,
} from '../../../src/systems/vehicles/hull-fire.js';
import { createVehicle } from '../../../src/systems/vehicles/index.js';
import { TEST_MANIFEST } from '../../fixtures/content.js';
import { ctxOf } from '../../fixtures/context.js';

// Hull fire: a ship under its fire share loses hitpoints slowly on its own until it sinks.

const VIKING = 1;
const P1 = 1;
const GRASS = 0;
const WATER = 1;
const SHIP = 3;
const CATAPULT = 5;
const SHIP_HITPOINTS = 10_000;
/** A ship is a vehicle with seats. */
const SHIP_SEATS = 9;
const CATAPULT_HITPOINTS = 3000;
const PERCENT = 100;
const MAP_W = 20;
const MAP_H = 10;
const SEA_FROM = 5;
const SEA_NODE = { x: 20, y: 10 };
const SHORE_NODE = { x: 4, y: 10 };

function content(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [{ typeId: 0, id: 'none' }],
    buildings: [],
    jobs: [{ typeId: 0, id: 'idle' }],
    landscape: [
      { typeId: GRASS, id: 'grass', walkable: true, buildable: true },
      { typeId: WATER, id: 'water', walkable: false, buildable: false },
    ],
    vehicles: [
      {
        typeId: SHIP,
        id: 'ship_small',
        jobId: 52,
        stockSlots: 50,
        logicSize: 2,
        passengerSlots: SHIP_SEATS,
        hitpoints: SHIP_HITPOINTS,
      },
      {
        typeId: CATAPULT,
        id: 'catapult',
        jobId: 54,
        stockSlots: 0,
        logicSize: 1,
        hitpoints: CATAPULT_HITPOINTS,
      },
    ],
    tribes: [{ typeId: VIKING, id: 'viking' }],
  });
}

function sim(): Simulation {
  const typeIds = Array.from({ length: MAP_W * MAP_H }, (_, i) => (i % MAP_W >= SEA_FROM ? WATER : GRASS));
  return new Simulation({
    seed: 1,
    content: content(),
    map: halfCellMapFromCells({ width: MAP_W, height: MAP_H, typeIds }),
  });
}

function vehicleAt(s: Simulation, type: number, at: { x: number; y: number }, hitpoints: number): Entity {
  const e = createVehicle(s.world, ctxOf(s), {
    vehicleType: type,
    x: at.x,
    y: at.y,
    tribe: VIKING,
    owner: P1,
  });
  if (e === null) throw new Error('setup: vehicle type missing');
  s.world.mut(e, Health).hitpoints = hitpoints;
  return e;
}

/** The hitpoints at the fire share of `max`, the last count that does not burn. */
function fireLine(max: number): number {
  return (max * SHIP_FIRE_HEALTH_PERCENT) / PERCENT;
}

describe('hull fire', () => {
  it('burns a ship under its fire share by the fire damage each second', () => {
    const s = sim();
    const start = fireLine(SHIP_HITPOINTS) - 1;
    const ship = vehicleAt(s, SHIP, SEA_NODE, start);

    s.run(2 * TICKS_PER_SECOND);

    expect(s.world.get(ship, Health).hitpoints).toBe(start - 2 * SHIP_FIRE_DAMAGE_PER_SECOND);
  });

  it('leaves a ship at its fire share and a land vehicle far under it alone', () => {
    const s = sim();
    const ship = vehicleAt(s, SHIP, SEA_NODE, fireLine(SHIP_HITPOINTS));
    const catapult = vehicleAt(s, CATAPULT, SHORE_NODE, 1);

    s.run(2 * TICKS_PER_SECOND);

    expect(s.world.get(ship, Health).hitpoints).toBe(fireLine(SHIP_HITPOINTS));
    expect(s.world.get(catapult, Health).hitpoints).toBe(1);
  });

  it('sinks a ship the fire burns out on the tick it burns out', () => {
    const s = sim();
    const ship = vehicleAt(s, SHIP, SEA_NODE, SHIP_FIRE_DAMAGE_PER_SECOND);

    for (let i = 0; i <= TICKS_PER_SECOND && s.world.isAlive(ship); i++) {
      s.step();
      // Cleanup runs after the fire, so a hull it empties never outlives the tick.
      if (s.world.isAlive(ship)) expect(s.world.get(ship, Health).hitpoints).toBeGreaterThan(0);
    }
    expect(s.world.isAlive(ship)).toBe(false);
  });
});
