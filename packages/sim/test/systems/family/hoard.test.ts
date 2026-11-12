import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Building,
  LostWay,
  MoveGoal,
  Position,
  Residence,
  Settler,
  Stockpile,
} from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { type SimEvent, Simulation } from '../../../src/index.js';
import { positionOfNode } from '../../../src/nav/halfcell.js';
import { TEST_MANIFEST } from '../../fixtures/content.js';
import { stepToIdleReplan } from '../../fixtures/idle-replan.js';
import { grassNodeMap } from '../../fixtures/terrain.js';

/**
 * The housewife's larder haul against food she cannot walk to: a pile lying inside a building's body is
 * no source, and a lost mark she earned lifts once her haul finds a way.
 */

const VIKING = 1;
const PLAYER = 0;
const FOOD = 16; // `food_simple`: the `food_` prefix is what makes it edible
const WOMAN = 5;
const HOME = 2;
const HALL = 7;
const LARDER_SLOT = 5;
const ROW = 4;
const WOMAN_X = 2;
const HOME_X = 8;
const HALL_X = 16;
/** A node of the hall's body, two off its door. */
const BURIED_X = HALL_X - 1;
const OPEN_PILE_X = 30;
const HAUL_TICKS = 2000;

function hoardContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: FOOD, id: 'food_simple' },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: WOMAN, id: 'woman' },
    ],
    landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
    buildings: [
      {
        typeId: HOME,
        id: 'home_level_00',
        kind: 'home',
        homeSize: 3,
        stock: [{ goodType: FOOD, capacity: LARDER_SLOT }],
      },
      {
        typeId: HALL,
        id: 'hall',
        kind: 'workplace',
        footprint: { blocked: [-1, 0, 1].map((dx) => ({ dx, dy: 0 })), door: { dx: 2, dy: 0 } },
      },
    ],
    tribes: [{ typeId: VIKING, id: 'viking' }],
  });
}

/** A housed woman, a hall between her home and the one pile on open ground, and a pile inside the hall's
 *  body: the state a pile is left in when something sets it down under a standing building. */
function hoardSim(): { sim: Simulation; woman: Entity; home: Entity; buried: Entity } {
  const sim = new Simulation({ seed: 5, content: hoardContent(), map: grassNodeMap(40, 8) });
  sim.enqueueSetup({ kind: 'setNeedsEnabled', enabled: false });
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HOME, x: HOME_X, y: ROW, tribe: VIKING });
  sim.enqueueSetup({ kind: 'placeBuilding', buildingType: HALL, x: HALL_X, y: ROW, tribe: VIKING });
  sim.enqueueSetup({
    kind: 'spawnSettler',
    jobType: WOMAN,
    x: WOMAN_X,
    y: ROW,
    tribe: VIKING,
    owner: PLAYER,
  });
  sim.enqueueSetup({ kind: 'dropGood', good: FOOD, x: OPEN_PILE_X, y: ROW, amount: 2 });
  sim.step();
  const woman = [...sim.world.query(Settler)][0];
  const home = [...sim.world.query(Building)].find((e) => sim.world.get(e, Building).buildingType === HOME);
  if (woman === undefined || home === undefined) throw new Error('setup: woman or home missing');
  sim.world.add(woman, Residence, { home });
  const buried = sim.world.create();
  sim.world.add(buried, Position, positionOfNode(BURIED_X, ROW));
  sim.world.add(buried, Stockpile, { amounts: new Map([[FOOD, 1]]) });
  return { sim, woman, home, buried };
}

function larderFood(sim: Simulation, home: Entity): number {
  return sim.world.get(home, Stockpile).amounts.get(FOOD) ?? 0;
}

function runUntilHauled(sim: Simulation, home: Entity, onTick: () => void = () => {}): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < HAUL_TICKS; i++) {
    sim.step();
    events.push(...sim.events.current());
    onTick();
    if (larderFood(sim, home) >= 1) return events;
  }
  throw new Error(`no food reached the larder within ${HAUL_TICKS} ticks`);
}

describe('housewife larder haul', () => {
  it('passes over a nearer pile buried in a building body and is never reported lost', () => {
    const { sim, woman, home, buried } = hoardSim();
    const buriedCell = sim.terrain?.nodeAtClamped(BURIED_X, ROW);

    const events = runUntilHauled(sim, home, () => {
      expect(sim.world.tryGet(woman, MoveGoal)?.cell).not.toBe(buriedCell);
    });

    expect(events.filter((event) => event.kind === 'settlerLost')).toEqual([]);
    expect(sim.world.has(woman, LostWay)).toBe(false);
    expect(sim.world.get(buried, Stockpile).amounts.get(FOOD)).toBe(1);
  });

  it('lifts a lost mark once her haul finds its way', () => {
    const { sim, woman, home } = hoardSim();
    const goal = sim.terrain?.nodeAtClamped(BURIED_X, ROW);
    if (goal === undefined) throw new Error('setup: terrain missing');
    sim.world.add(woman, LostWay, { cutOff: false, since: sim.tick, goal, tried: null });

    runUntilHauled(sim, home);

    expect(sim.world.has(woman, LostWay)).toBe(false);
  });

  it('lifts a lost mark when the home wants nothing more', () => {
    const { sim, woman, home } = hoardSim();
    const goal = sim.terrain?.nodeAtClamped(BURIED_X, ROW);
    if (goal === undefined) throw new Error('setup: terrain missing');
    sim.world.mut(home, Stockpile).amounts.set(FOOD, LARDER_SLOT);
    sim.world.add(woman, LostWay, { cutOff: false, since: sim.tick, goal, tried: null });

    stepToIdleReplan(sim, woman);

    expect(sim.world.has(woman, LostWay)).toBe(false);
  });
});
