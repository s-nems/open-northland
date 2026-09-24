import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  addPerson,
  Building,
  Female,
  Marriage,
  MoveGoal,
  Owner,
  Position,
  Residence,
  Settler,
} from '../../src/components/index.js';
import { fx, ONE } from '../../src/core/fixed.js';
import type { Entity } from '../../src/ecs/world.js';
import { parseCommandEnvelope, playerCommand, replay, Simulation } from '../../src/index.js';
import { nodeOfPosition, positionOfNode } from '../../src/nav/halfcell.js';
import { familiesOf } from '../../src/systems/index.js';
import { groupPlacementOrder } from '../../src/systems/orders/group-placement.js';
import { assignHouse, assignHouseGroup } from '../../src/systems/orders/index.js';
import { stepOffHomeDoor } from '../../src/systems/settlers/drives/spacing.js';
import { PlannerSpacing } from '../../src/systems/settlers/planner/spacing.js';
import { interactionCell } from '../../src/systems/settlers/targets/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';
import { ctxOf } from '../fixtures/context.js';
import { grassNodeMap as grassMap } from '../fixtures/terrain.js';

/**
 * The `assignHouseGroup` command: a group sent to one home fills its family slots nearest first with
 * its homeless families while there are any, otherwise with its families housed elsewhere. The home
 * here holds {@link HOME_SIZE} families, the big one {@link BIG_HOME_SIZE}.
 */

const VIKING = 1;
const PLAYER = 0;
const WOMAN = 5;
const CIVILIST = 6;
const HOME = 2;
const HOME_SIZE = 2;
const BIG_HOME = 3;
const BIG_HOME_SIZE = 5;
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
    buildings: [
      { typeId: HOME, id: 'home_level_00', kind: 'home', homeSize: HOME_SIZE },
      { typeId: BIG_HOME, id: 'home_level_04', kind: 'home', homeSize: BIG_HOME_SIZE },
    ],
  });
}

function homeAt(sim: Simulation, x: number, buildingType = HOME): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(0) });
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: ONE, level: 0 });
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
  });
  sim.world.add(e, Owner, { player: PLAYER });
  if (female) sim.world.add(e, Female, { female: true });
  return e;
}

function sendGroup(sim: Simulation, house: Entity, entities: readonly Entity[]): void {
  const members = entities.map((entity) => ({ entity }));
  assignHouseGroup(sim.world, ctxOf(sim), { kind: 'assignHouseGroup', members, house });
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

  it('moves a group housed elsewhere in when none of it is homeless', () => {
    const sim = new Simulation({ seed: 1, content: content() });
    const oldHome = homeAt(sim, 30);
    const clicked = homeAt(sim, 10);
    const group = [adultAt(sim, 30), adultAt(sim, 31)];
    for (const entity of group) {
      assignHouse(sim.world, ctxOf(sim), { kind: 'assignHouse', entity, house: oldHome });
    }

    sendGroup(sim, clicked, group);

    expect(group.map((e) => homeOf(sim, e))).toEqual([clicked, clicked]);
  });

  it('keeps members housed elsewhere put while any member is homeless, though room is left', () => {
    const sim = new Simulation({ seed: 1, content: content() });
    const first = homeAt(sim, 10);
    const bigger = homeAt(sim, 40, BIG_HOME);
    const group = [adultAt(sim, 11), adultAt(sim, 12), adultAt(sim, 13), adultAt(sim, 14)];

    sendGroup(sim, first, group);
    sendGroup(sim, bigger, group);

    expect(group.map((e) => homeOf(sim, e))).toEqual([first, first, bigger, bigger]);
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

  it('moves idle residents away from the door when every family slot is occupied', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(48, 4) });
    const house = homeAt(sim, 10);
    const women = [adultAt(sim, 10), adultAt(sim, 10)];
    sendGroup(sim, house, women);
    expect(familiesOf(sim.world, house)).toHaveLength(HOME_SIZE);
    if (sim.terrain === undefined) throw new Error('setup: terrain missing');
    const door = interactionCell(sim.world, ctxOf(sim), sim.terrain, house);

    sim.run(20);

    for (const woman of women) {
      const p = sim.world.get(woman, Position);
      const at = nodeOfPosition(p.x, p.y);
      expect(sim.terrain.nodeAtClamped(at.hx, at.hy)).not.toBe(door);
    }
  });

  it('finds a clear stand beyond a crowded doorway yard', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(48, 8) });
    const house = homeAt(sim, 10);
    const woman = adultAt(sim, 10);
    sendGroup(sim, house, [woman]);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('setup: terrain missing');
    const ctx = ctxOf(sim);
    const door = interactionCell(sim.world, ctx, terrain, house);
    sim.world.add(woman, Position, positionOfNode(terrain.xOf(door), terrain.yOf(door)));
    const yard = PlannerSpacing.forTick(sim.world, ctx, terrain).yard(door);
    for (const cell of yard) {
      if (cell === door) continue;
      const blocker = adultAt(sim, 10);
      sim.world.add(blocker, Position, positionOfNode(terrain.xOf(cell), terrain.yOf(cell)));
    }
    const spacing = PlannerSpacing.forTick(sim.world, ctx, terrain);

    expect(stepOffHomeDoor(sim.world, ctx, terrain, woman, door, spacing)).toBe(true);
    const stand = sim.world.get(woman, MoveGoal).cell;
    expect(yard.has(stand)).toBe(false);
    expect(spacing.isClaimed(stand)).toBe(true);
  });

  it('leaves an unowned resident at the doorway', () => {
    const sim = new Simulation({ seed: 1, content: content(), map: grassMap(48, 4) });
    const house = homeAt(sim, 10);
    const woman = adultAt(sim, 10);
    sendGroup(sim, house, [woman]);
    sim.world.remove(woman, Owner);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('setup: terrain missing');
    const ctx = ctxOf(sim);
    const door = interactionCell(sim.world, ctx, terrain, house);
    const spacing = PlannerSpacing.forTick(sim.world, ctx, terrain);

    expect(stepOffHomeDoor(sim.world, ctx, terrain, woman, door, spacing)).toBe(false);
    expect(sim.world.has(woman, MoveGoal)).toBe(false);
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
    const members = [...sim.world.query(Settler)].sort((a, b) => a - b).map((entity) => ({ entity }));
    for (const house of homes) {
      const order = playerCommand(PLAYER, { kind: 'assignHouseGroup', members, house });
      sim.enqueue(parseCommandEnvelope(JSON.parse(JSON.stringify(order))));
    }
    sim.step();

    for (const house of homes) expect(familiesOf(sim.world, house)).toHaveLength(HOME_SIZE);
    const replayed = replay({ content: content(), seed: 7, map, log: sim.commands.log, untilTick: sim.tick });
    expect(replayed.hashState()).toBe(sim.hashState());
  });
});

describe('groupPlacementOrder - whom a group order tries first', () => {
  it('breaks a distance tie by ascending id, ranks a member it cannot measure last, and drops repeats', () => {
    const sim = new Simulation({ seed: 1, content: content() });
    const house = homeAt(sim, 10);
    const unmeasured = adultAt(sim, 11);
    sim.world.remove(unmeasured, Position);
    const lower = adultAt(sim, 20);
    const higher = adultAt(sim, 20);
    const nearest = adultAt(sim, 12);
    const members = [higher, unmeasured, lower, nearest, higher].map((entity) => ({ entity }));

    const order = groupPlacementOrder(sim.world, ctxOf(sim), members, house, (e) => homeOf(sim, e));

    expect(order.map((member) => member.entity)).toEqual([nearest, lower, higher, unmeasured]);
    expect(order[2]).toBe(members[0]); // the first entry of the repeated member
  });
});
