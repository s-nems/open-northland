import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  Female,
  Marriage,
  Owner,
  Position,
  Residence,
  Settler,
} from '../../src/components/index.js';
import { fx, ONE } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { parseCommandEnvelope, playerCommand, replay, Simulation } from '../../src/index.js';
import { familiesOf } from '../../src/systems/index.js';
import { assignHouse, assignHouseGroup } from '../../src/systems/orders/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap as grassMap } from '../fixtures/terrain.js';

/**
 * The `assignHouseGroup` command: a group sent to one home fills its family slots with homeless
 * families first, then with families housed elsewhere, each nearest the home first. The home here
 * holds {@link HOME_SIZE} families.
 */

const VIKING = 1;
const PLAYER = 0;
const WOMAN = 5;
const CIVILIST = 6;
const HOME = 2;
const HOME_SIZE = 2;
const GRASS = 0;

function content(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: WOMAN, id: 'woman' },
      { typeId: CIVILIST, id: 'civilist' },
    ],
    landscape: [{ typeId: GRASS, id: 'grass', walkable: true, buildable: true }],
    buildings: [{ typeId: HOME, id: 'home_level_00', kind: 'home', homeSize: HOME_SIZE }],
  });
}

function homeAt(sim: Simulation, x: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
  sim.world.add(e, Building, { buildingType: HOME, tribe: VIKING, built: ONE, level: 0 });
  return e;
}

/** An owned viking adult at column `x`: a woman, or a man when `female` is false. */
function adultAt(sim: Simulation, x: number, female = true): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType: female ? WOMAN : CIVILIST,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Owner, { player: PLAYER });
  if (female) sim.world.add(e, Female, { female: true });
  return e;
}

function sendGroup(sim: Simulation, house: Entity, entities: readonly Entity[]): void {
  assignHouseGroup(sim.world, ctxOf(sim), { kind: 'assignHouseGroup', entities, house });
}

const homeOf = (sim: Simulation, e: Entity): Entity | undefined => sim.world.tryGet(e, Residence)?.home;

describe('assignHouseGroup - send a group to one home', () => {
  it('houses homeless members before one housed elsewhere, even a nearer one listed first', () => {
    const sim = new Simulation({ seed: 1, content: content() });
    const oldHome = homeAt(sim, 30);
    const clicked = homeAt(sim, 10);
    const housed = adultAt(sim, 10);
    const homelessA = adultAt(sim, 40);
    const homelessB = adultAt(sim, 42);
    assignHouse(sim.world, ctxOf(sim), { kind: 'assignHouse', entity: housed, house: oldHome });

    sendGroup(sim, clicked, [housed, homelessA, homelessB]);

    expect(homeOf(sim, homelessA)).toBe(clicked);
    expect(homeOf(sim, homelessB)).toBe(clicked);
    expect(homeOf(sim, housed)).toBe(oldHome);
  });

  it('moves members housed elsewhere into the slots the homeless leave free', () => {
    const sim = new Simulation({ seed: 1, content: content() });
    const oldHome = homeAt(sim, 30);
    const clicked = homeAt(sim, 10);
    const housed = adultAt(sim, 30);
    const homeless = adultAt(sim, 12);
    assignHouse(sim.world, ctxOf(sim), { kind: 'assignHouse', entity: housed, house: oldHome });

    sendGroup(sim, clicked, [housed, homeless]);

    expect(homeOf(sim, homeless)).toBe(clicked);
    expect(homeOf(sim, housed)).toBe(clicked);
  });

  it('lets a second home take the rest of the group instead of the ones the first home took', () => {
    const sim = new Simulation({ seed: 1, content: content() });
    const first = homeAt(sim, 10);
    const second = homeAt(sim, 40);
    const group = [adultAt(sim, 11), adultAt(sim, 12), adultAt(sim, 13), adultAt(sim, 14)];

    sendGroup(sim, first, group);
    sendGroup(sim, second, group);

    expect(familiesOf(sim.world, first)).toHaveLength(HOME_SIZE);
    expect(familiesOf(sim.world, second)).toHaveLength(HOME_SIZE);
    expect(group.map((e) => homeOf(sim, e))).toEqual([first, first, second, second]);
  });

  it('counts a selected couple as the one family slot it takes', () => {
    const sim = new Simulation({ seed: 1, content: content() });
    const clicked = homeAt(sim, 10);
    const wife = adultAt(sim, 11);
    const husband = adultAt(sim, 12, false);
    sim.world.add(wife, Marriage, { spouse: husband, child: null });
    sim.world.add(husband, Marriage, { spouse: wife, child: null });
    const single = adultAt(sim, 20);

    sendGroup(sim, clicked, [wife, husband, single]);

    expect([homeOf(sim, wife), homeOf(sim, husband), homeOf(sim, single)]).toEqual([
      clicked,
      clicked,
      clicked,
    ]);
    expect(familiesOf(sim.world, clicked)).toHaveLength(HOME_SIZE);
  });

  it('reaches the sim from a seat over the wire and replays to the same state', () => {
    const map = grassMap(48, 4);
    const sim = new Simulation({ seed: 7, content: content(), map });
    for (const x of [8, 30])
      sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HOME, x, y: 0, tribe: VIKING });
    for (const x of [10, 12, 14, 16]) {
      sim.enqueueSetup({ kind: 'spawnSettler', jobType: WOMAN, x, y: 0, tribe: VIKING, owner: PLAYER });
    }
    sim.step();
    sim.step(); // the homes finish on the setup tick's system run
    const homes = [...sim.world.query(Building)].sort((a, b) => a - b);
    const group = [...sim.world.query(Settler)].sort((a, b) => a - b);
    for (const house of homes) {
      const order = playerCommand(PLAYER, { kind: 'assignHouseGroup', entities: group, house });
      sim.enqueue(parseCommandEnvelope(JSON.parse(JSON.stringify(order))));
    }
    sim.step();

    for (const house of homes) expect(familiesOf(sim.world, house)).toHaveLength(HOME_SIZE);
    const replayed = replay({ content: content(), seed: 7, map, log: sim.commands.log, untilTick: sim.tick });
    expect(replayed.hashState()).toBe(sim.hashState());
  });
});
