import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Age,
  Building,
  DefenceMode,
  Health,
  Owner,
  Position,
  Resting,
  Settler,
  Sheltering,
  Stance,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import {
  fx,
  halfCellMapFromCells,
  ONE,
  positionOfNode,
  Simulation,
  type TerrainMap,
} from '../../src/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { TEST_MANIFEST } from '../fixtures/content.js';

// DEFENCE MODE - the alarm a player raises on a garrison building: its civilians run inside, shoot the
// house bow from cover, and stay there until it drops. Source basis: the mode is extracted
// (`houses.ini` `logicCanEnableDefenceMode` on the HQ, barracks and both towers); the shelter semantics,
// the garrison size, and who runs for cover are named approximations (user rules).

const VIKING = 1;
const P1 = 1; // the sheltering player
const P2 = 2; // the attacker

const FARMER = 2; // a civilian trade - runs for cover
const SOLDIER = 31; // `soldier_unarmed` - the slug isFighterJob keys on; never shelters
const SCOUT = 14; // `scout` - never shelters either
const CHILD = 4; // `child_male` - the age class hides but never fights (`lifecycle/ageclass.ts`)
const TOWER = 40;
const HUT = 41; // no shelterCapacity: a building that cannot raise the alarm at all

const TOWER_CAPACITY = 2;
const HOUSE_BOW_DAMAGE = 30;
const HOUSE_BOW_RANGE = 6;
const RAIDER_HP = 500;

/** One tribe fought across two players, a tower that shelters {@link TOWER_CAPACITY} civilians and a hut
 *  that shelters nobody, the civilian house bow (bound by id, no jobType - a sheltering settler keeps its
 *  own trade and wears the bow), and a short-range raider mace. */
function defenceContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [{ typeId: 0, id: 'none' }],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: CHILD, id: 'child_male' },
      { typeId: FARMER, id: 'farmer' },
      { typeId: SOLDIER, id: 'soldier_unarmed' },
      { typeId: SCOUT, id: 'scout' },
    ],
    buildings: [
      { typeId: TOWER, id: 'tower_00', kind: 'tower', hitpoints: 100_000, shelterCapacity: TOWER_CAPACITY },
      { typeId: HUT, id: 'hut', kind: 'home', hitpoints: 1000 },
    ],
    landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
    weapons: [
      {
        typeId: 20,
        id: 'house_bow',
        tribeType: VIKING,
        minRange: 1,
        maxRange: HOUSE_BOW_RANGE,
        damage: { '0': HOUSE_BOW_DAMAGE },
      },
      {
        typeId: 7,
        id: 'viking_mace',
        tribeType: VIKING,
        jobType: SOLDIER,
        minRange: 1,
        maxRange: 2,
        damage: { '0': 40, '7': 25 },
      },
    ],
    tribes: [
      {
        typeId: VIKING,
        id: 'viking',
        atomicBindings: [
          { jobType: FARMER, atomicId: 81, animation: 'viking_attack' },
          { jobType: SOLDIER, atomicId: 81, animation: 'viking_attack' },
        ],
      },
    ],
    atomicAnimations: [{ id: 'viking_attack', name: 'viking_attack', length: 4 }],
  });
}

/** An all-grass w×h-cell terrain map, upsampled to the half-cell lattice. */
function grass(width: number, height: number): TerrainMap {
  return halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(0) });
}

function settlerAt(sim: Simulation, x: number, y: number, owner: number, jobType: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  sim.world.add(e, Settler, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Health, { hitpoints: RAIDER_HP, max: RAIDER_HP });
  sim.world.add(e, Owner, { player: owner });
  sim.world.add(e, Stance, {
    mode: jobType === SOLDIER ? MILITARY_MODE.ATTACK : MILITARY_MODE.FLEE,
    anchorCell: null,
  });
  return e;
}

function buildingAt(sim: Simulation, x: number, y: number, buildingType: number, owner: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(2 * x, 2 * y));
  sim.world.add(e, Building, { buildingType, tribe: VIKING, built: ONE, level: 0 });
  sim.world.add(e, Health, { hitpoints: 100_000, max: 100_000 });
  sim.world.add(e, Owner, { player: owner });
  return e;
}

/** Step until `done` holds, or `ticks` elapse - the shelter run is a walk, so the assertions wait for
 *  arrival rather than pinning an exact tick count. */
function stepUntil(sim: Simulation, ticks: number, done: () => boolean): void {
  for (let i = 0; i < ticks && !done(); i++) sim.step();
}

const shelterOf = (sim: Simulation, e: Entity): Entity | undefined =>
  sim.world.tryGet(e, Sheltering)?.shelter;
const insideOf = (sim: Simulation, e: Entity): Entity | undefined => sim.world.tryGet(e, Resting)?.at;

describe('defence mode', () => {
  it('raises the alarm on a garrison building and rings the civil-defence bells once', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(10, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);

    sim.enqueue({ kind: 'setDefenceMode', building: tower, enabled: true });
    sim.step();
    const first = sim.events.current().filter((ev) => ev.kind === 'defenceAlarmRaised');

    sim.enqueue({ kind: 'setDefenceMode', building: tower, enabled: true }); // re-raise: already up
    sim.step();
    const second = sim.events.current().filter((ev) => ev.kind === 'defenceAlarmRaised');

    expect(sim.world.has(tower, DefenceMode)).toBe(true);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ entity: tower, player: P1 });
    expect(second).toHaveLength(0); // no second bell for an alarm that was already up
  });

  it('refuses the order for a building type with no garrison', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(10, 4) });
    const hut = buildingAt(sim, 5, 1, HUT, P1);

    sim.enqueue({ kind: 'setDefenceMode', building: hut, enabled: true });
    sim.step();

    expect(sim.world.has(hut, DefenceMode)).toBe(false);
  });

  it('runs civilians into the tower and leaves fighters and scouts at work', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(10, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const farmer = settlerAt(sim, 1, 1, P1, FARMER);
    const soldier = settlerAt(sim, 2, 1, P1, SOLDIER);
    const scout = settlerAt(sim, 3, 1, P1, SCOUT);

    sim.enqueue({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, farmer) === tower);

    expect(insideOf(sim, farmer)).toBe(tower); // hidden inside, so the render stops drawing it
    expect(shelterOf(sim, soldier)).toBeUndefined();
    expect(shelterOf(sim, scout)).toBeUndefined();
  });

  it('shelters only up to the type capacity and leaves the overflow outside', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(10, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const civilians = [1, 2, 3].map((x) => settlerAt(sim, x, 1, P1, FARMER));

    sim.enqueue({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => civilians.filter((e) => insideOf(sim, e) === tower).length >= TOWER_CAPACITY);
    sim.step();

    expect(civilians.filter((e) => shelterOf(sim, e) === tower)).toHaveLength(TOWER_CAPACITY);
  });

  it('splits the crowd across two alarms, each civilian taking the nearer tower', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(20, 4) });
    const west = buildingAt(sim, 2, 1, TOWER, P1);
    const east = buildingAt(sim, 17, 1, TOWER, P1);
    const nearWest = settlerAt(sim, 4, 1, P1, FARMER);
    const nearEast = settlerAt(sim, 15, 1, P1, FARMER);

    sim.enqueue({ kind: 'setDefenceMode', building: west, enabled: true });
    sim.enqueue({ kind: 'setDefenceMode', building: east, enabled: true });
    stepUntil(
      sim,
      400,
      () => shelterOf(sim, nearWest) !== undefined && shelterOf(sim, nearEast) !== undefined,
    );

    expect(shelterOf(sim, nearWest)).toBe(west);
    expect(shelterOf(sim, nearEast)).toBe(east);
  });

  it("sends a tower's people to the other tower when its alarm is called off", () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(20, 4) });
    const west = buildingAt(sim, 2, 1, TOWER, P1);
    const east = buildingAt(sim, 17, 1, TOWER, P1);
    const farmer = settlerAt(sim, 4, 1, P1, FARMER);

    sim.enqueue({ kind: 'setDefenceMode', building: west, enabled: true });
    sim.enqueue({ kind: 'setDefenceMode', building: east, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, farmer) === west);
    expect(insideOf(sim, farmer)).toBe(west);

    sim.enqueue({ kind: 'setDefenceMode', building: west, enabled: false });
    stepUntil(sim, 600, () => insideOf(sim, farmer) === east);

    expect(shelterOf(sim, farmer)).toBe(east);
    expect(insideOf(sim, farmer)).toBe(east);
  });

  it('releases everyone and stops the hiding when the last alarm drops', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(10, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const farmer = settlerAt(sim, 1, 1, P1, FARMER);

    sim.enqueue({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, farmer) === tower);

    sim.enqueue({ kind: 'setDefenceMode', building: tower, enabled: false });
    sim.step();

    expect(sim.world.has(farmer, Sheltering)).toBe(false);
    expect(sim.world.has(farmer, Resting)).toBe(false); // stepped back out, drawn again
  });

  it('shoots the house bow at a raider in reach and cannot be shot back at', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(12, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const farmer = settlerAt(sim, 4, 1, P1, FARMER);

    sim.enqueue({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, farmer) === tower);
    // The raider walks up only after the farmer is under cover, so the shelter run is never a flight.
    const raider = settlerAt(sim, 7, 1, P2, SOLDIER);

    stepUntil(sim, 600, () => sim.world.get(raider, Health).hitpoints < RAIDER_HP);

    expect(sim.world.get(raider, Health).hitpoints).toBeLessThan(RAIDER_HP); // arrows landed
    expect(sim.world.get(farmer, Health).hitpoints).toBe(RAIDER_HP); // never targeted behind the walls
    expect(insideOf(sim, farmer)).toBe(tower); // and never stepped out to chase
  });

  it('leaves a civilian outside its work area at work - the alarm does not suspend the signpost rule', () => {
    // Wide enough that the far tower sits past the settler's own reach and past any signpost group it
    // could get to (there are none), so the run for cover is illegal exactly as an errand there would be.
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(60, 4) });
    const near = buildingAt(sim, 3, 1, TOWER, P1);
    const far = buildingAt(sim, 55, 1, TOWER, P1);
    const homebody = settlerAt(sim, 1, 1, P1, FARMER);
    const outlier = settlerAt(sim, 30, 1, P1, FARMER);

    sim.enqueue({ kind: 'setSignpostNavigation', enabled: true });
    sim.enqueue({ kind: 'setDefenceMode', building: near, enabled: true });
    sim.enqueue({ kind: 'setDefenceMode', building: far, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, homebody) === near);

    expect(insideOf(sim, homebody)).toBe(near); // in reach of its own tower - takes cover
    expect(shelterOf(sim, outlier)).toBeUndefined(); // out of reach of both - keeps working
  });

  it("hides a child without arming it - the bow is the grown civilians'", () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(12, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const child = settlerAt(sim, 4, 1, P1, CHILD);
    sim.world.add(child, Age, { ticks: 0 }); // the born-young marker every growing settler carries

    sim.enqueue({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, child) === tower);
    const raider = settlerAt(sim, 8, 1, P2, SOLDIER);
    for (let i = 0; i < 300; i++) sim.step();

    expect(insideOf(sim, child)).toBe(tower); // it does take cover with everyone else…
    expect(sim.world.get(raider, Health).hitpoints).toBe(RAIDER_HP); // …but never looses an arrow
  });

  it('keeps a starving settler under cover instead of walking it out to eat', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(10, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const farmer = settlerAt(sim, 1, 1, P1, FARMER);

    sim.enqueue({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, farmer) === tower);
    sim.world.write(farmer, Settler, (s) => {
      s.hunger = ONE;
      s.fatigue = ONE;
      s.piety = ONE;
    });

    for (let i = 0; i < 200; i++) sim.step();

    expect(insideOf(sim, farmer)).toBe(tower);
  });
});
