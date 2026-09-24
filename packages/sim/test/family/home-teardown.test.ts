import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  Female,
  Health,
  Owner,
  Position,
  Residence,
} from '../../src/components/index.js';
import { fx, ONE } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import { assignHouse } from '../../src/systems/orders/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';

/**
 * A home that leaves the map takes its households' {@link Residence} with it, so the family reads as
 * homeless to everything that re-houses one: the player's group placement and the AI's home expansion.
 */

const VIKING = 1;
const PLAYER = 0;
const WOMAN = 5;
const CIVILIST = 6;
const HOME = 2;
const HOME_SIZE = 2;
const HOME_HITPOINTS = 100;

function content(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: WOMAN, id: 'woman' },
      { typeId: CIVILIST, id: 'civilist' },
    ],
    buildings: [{ typeId: HOME, id: 'home_level_00', kind: 'home', homeSize: HOME_SIZE }],
  });
}

function homeAt(sim: Simulation, x: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
  sim.world.add(e, Building, { buildingType: HOME, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Owner, { player: PLAYER });
  return e;
}

function womanHousedIn(sim: Simulation, home: Entity): Entity {
  const e = sim.world.create();
  const p = sim.world.get(home, Position);
  sim.world.add(e, Position, { x: p.x, y: p.y });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType: WOMAN,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
  });
  sim.world.add(e, Owner, { player: PLAYER });
  sim.world.add(e, Female, { female: true });
  assignHouse(sim.world, ctxOf(sim), { kind: 'assignHouse', entity: e, house: home });
  expect(sim.world.get(e, Residence).home).toBe(home);
  return e;
}

describe('a home leaving the map', () => {
  it('evicts its residents when the player demolishes it, and nobody else', () => {
    const sim = new Simulation({ seed: 1, content: content() });
    const razed = homeAt(sim, 10);
    const standing = homeAt(sim, 30);
    const evicted = womanHousedIn(sim, razed);
    const neighbour = womanHousedIn(sim, standing);

    sim.enqueueSetup({ kind: 'demolish', building: razed });
    sim.step();

    expect(sim.world.isAlive(razed)).toBe(false);
    expect(sim.world.has(evicted, Residence)).toBe(false);
    expect(sim.world.get(neighbour, Residence).home).toBe(standing);
  });

  it('evicts its residents when combat razes it', () => {
    const sim = new Simulation({ seed: 1, content: content() });
    const razed = homeAt(sim, 10);
    const evicted = womanHousedIn(sim, razed);
    sim.world.add(razed, Health, { hitpoints: 0, max: HOME_HITPOINTS });

    sim.step();

    expect(sim.world.isAlive(razed)).toBe(false);
    expect(sim.world.has(evicted, Residence)).toBe(false);
  });
});
