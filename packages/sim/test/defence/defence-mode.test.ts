import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import {
  Age,
  AttackOrder,
  addPerson,
  Building,
  Carrying,
  CurrentAtomic,
  DefenceMode,
  Fleeing,
  Health,
  IdleStand,
  Owner,
  Position,
  Projectile,
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
import { SHELTER_SHOT_PERIOD_TICKS, shotsDue } from '../../src/systems/conflict/shelter-fire.js';
import { shelterOccupancy } from '../../src/systems/defence/index.js';
import { MILITARY_MODE } from '../../src/systems/readviews/index.js';
import { idleReplanDue } from '../../src/systems/settlers/planner/idle-replan.js';
import { TEST_MANIFEST } from '../fixtures/content.js';

// DEFENCE MODE - the alarm a player raises on a garrison building: its civilians run inside, the building
// shoots the house bow at a rate their number sets, and they stay there until it drops. Source basis: the
// mode is extracted (`houses.ini` `logicCanEnableDefenceMode` on the HQ, barracks and both towers); the
// fire and the garrison size are the original's, who runs for cover is a named approximation.

const VIKING = 1;
const P1 = 1; // the sheltering player
const P2 = 2; // the attacker

const FARMER = 2; // a civilian trade - runs for cover
const SOLDIER = 31; // `soldier_unarmed` - the slug isFighterJob keys on; never shelters
const SCOUT = 14; // `scout` - never shelters either
const CHILD = 4; // `child_male` - the age class hides but never fights (`lifecycle/ageclass.ts`)
const TOWER = 40;
const HUT = 41; // no shelterCapacity: a building that cannot raise the alarm at all
const HALL = 39; // a long garrison building, whose walls stand far off its centre
/** How far the hall's walls reach east and west of its anchor, in half-cell nodes. */
const HALL_HALF_LENGTH_NODES = 12;

const TOWER_CAPACITY = 2;
const HOUSE_BOW_DAMAGE = 30;
const HOUSE_BOW_RANGE = 6;
const RAIDER_HP = 500;
/** A mark deep enough to outlive a long window, so the targets under test never change mid-run. */
const TOUGH_HP = 100_000;
/** A food good, so a settler under cover can answer hunger from what it carries. */
const RATION = 1;

/** One tribe fought across two players, a tower and a long hall that shelter {@link TOWER_CAPACITY}
 *  civilians each, a hut that shelters nobody, the house bow the sheltering buildings fire (bound by id,
 *  no jobType), and a short-range raider mace. */
function defenceContent(houseBowRange = HOUSE_BOW_RANGE): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: RATION, id: 'food_simple', weight: 1 },
    ],
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
      {
        typeId: HALL,
        id: 'barracks',
        kind: 'training',
        hitpoints: 100_000,
        shelterCapacity: TOWER_CAPACITY,
        footprint: {
          blocked: Array.from({ length: 2 * HALL_HALF_LENGTH_NODES + 1 }, (_, i) => ({
            dx: i - HALL_HALF_LENGTH_NODES,
            dy: 0,
          })),
          door: { dx: 0, dy: 2 },
        },
      },
    ],
    landscape: [{ typeId: 0, id: 'grass', walkable: true, buildable: true }],
    weapons: [
      {
        typeId: 20,
        id: 'house_bow',
        tribeType: VIKING,
        munitionType: 1, // an arrow, like the extracted row - so a garrison shot really is a projectile
        speed: 7,
        minRange: 1,
        maxRange: houseBowRange,
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
        // One `jobEnables` edge makes it a tribe with an economy behind it, which is what gives its
        // settlers needs at all; the edge itself gates nothing these cases exercise.
        jobEnables: [{ jobType: FARMER, kind: 'job', targetId: SOLDIER }],
        atomicBindings: [
          { jobType: SOLDIER, atomicId: 81, animation: 'viking_attack' },
          { jobType: FARMER, atomicId: 10, animation: 'viking_eat' },
        ],
      },
    ],
    atomicAnimations: [
      { id: 'viking_attack', name: 'viking_attack', length: 4 },
      // The eat clip's single `event <at> 2 +4000`: what one ration is worth to the eater's hunger.
      { id: 'viking_eat', name: 'viking_eat', length: 5, events: [{ at: 3, type: 2, value: 4000 }] },
    ],
  });
}

/** An all-grass w×h-cell terrain map, upsampled to the half-cell lattice. */
function grass(width: number, height: number): TerrainMap {
  return halfCellMapFromCells({ width, height, typeIds: new Array(width * height).fill(0) });
}

function settlerAt(sim: Simulation, x: number, y: number, owner: number, jobType: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  addPerson(sim.world, e, {
    tribe: VIKING,
    jobType,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
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

interface Shot {
  readonly source: Entity;
  readonly target: Entity;
  readonly cover: Entity | null;
}

/** Every shot loosed over the next `ticks` ticks, read at launch. */
function collectShots(sim: Simulation, ticks: number): Shot[] {
  const seen = new Set<Entity>();
  const shots: Shot[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step();
    for (const p of sim.world.query(Projectile)) {
      if (seen.has(p)) continue;
      seen.add(p);
      const { source, target, cover } = sim.world.get(p, Projectile);
      shots.push({ source, target, cover });
    }
  }
  return shots;
}

/** An enemy that holds its ground and soaks the fire without dying. */
function standingMark(sim: Simulation, x: number, y: number): Entity {
  const e = settlerAt(sim, x, y, P2, SOLDIER);
  sim.world.mut(e, Stance).mode = MILITARY_MODE.IGNORE;
  sim.world.mut(e, Health).max = TOUGH_HP;
  sim.world.mut(e, Health).hitpoints = TOUGH_HP;
  return e;
}

const shelterOf = (sim: Simulation, e: Entity): Entity | undefined =>
  sim.world.tryGet(e, Sheltering)?.shelter;
const insideOf = (sim: Simulation, e: Entity): Entity | undefined => sim.world.tryGet(e, Resting)?.at;

describe('defence mode', () => {
  it('raises the alarm on a garrison building and rings the civil-defence bells once', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(10, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
    sim.step();
    const first = sim.events.current().filter((ev) => ev.kind === 'defenceAlarmRaised');

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true }); // re-raise: already up
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

    sim.enqueueSetup({ kind: 'setDefenceMode', building: hut, enabled: true });
    sim.step();

    expect(sim.world.has(hut, DefenceMode)).toBe(false);
  });

  it('runs civilians into the tower and leaves fighters and scouts at work', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(10, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const farmer = settlerAt(sim, 1, 1, P1, FARMER);
    const soldier = settlerAt(sim, 2, 1, P1, SOLDIER);
    const scout = settlerAt(sim, 3, 1, P1, SCOUT);

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, farmer) === tower);

    expect(insideOf(sim, farmer)).toBe(tower); // hidden inside, so the render stops drawing it
    expect(shelterOf(sim, soldier)).toBeUndefined();
    expect(shelterOf(sim, scout)).toBeUndefined();
  });

  it('an idle civilian waiting out its idle period runs for cover on the alarm tick', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(10, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const farmer = settlerAt(sim, 1, 1, P1, FARMER);
    sim.step(); // no field to work: it stands idle
    expect(sim.world.has(farmer, IdleStand)).toBe(true);
    while (idleReplanDue(sim.tick + 1, farmer)) sim.step();

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
    sim.step(); // not its re-plan tick, but the alarm outranks the wait

    expect(shelterOf(sim, farmer)).toBe(tower);
  });

  it('shelters only up to the type capacity and leaves the overflow outside', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(10, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const civilians = [1, 2, 3].map((x) => settlerAt(sim, x, 1, P1, FARMER));

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
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

    sim.enqueueSetup({ kind: 'setDefenceMode', building: west, enabled: true });
    sim.enqueueSetup({ kind: 'setDefenceMode', building: east, enabled: true });
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

    sim.enqueueSetup({ kind: 'setDefenceMode', building: west, enabled: true });
    sim.enqueueSetup({ kind: 'setDefenceMode', building: east, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, farmer) === west);
    expect(insideOf(sim, farmer)).toBe(west);

    sim.enqueueSetup({ kind: 'setDefenceMode', building: west, enabled: false });
    stepUntil(sim, 600, () => insideOf(sim, farmer) === east);

    expect(shelterOf(sim, farmer)).toBe(east);
    expect(insideOf(sim, farmer)).toBe(east);
  });

  it('releases everyone and stops the hiding when the last alarm drops', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(10, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const farmer = settlerAt(sim, 1, 1, P1, FARMER);

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, farmer) === tower);

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: false });
    sim.step();

    expect(sim.world.has(farmer, Sheltering)).toBe(false);
    expect(sim.world.has(farmer, Resting)).toBe(false); // stepped back out, drawn again
  });

  it('shoots the house bow at a raider in reach and cannot be shot back at', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(12, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const farmer = settlerAt(sim, 4, 1, P1, FARMER);

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, farmer) === tower);
    // The raider walks up only after the farmer is under cover, so the shelter run is never a flight.
    const raider = settlerAt(sim, 7, 1, P2, SOLDIER);

    stepUntil(sim, 600, () => sim.world.get(raider, Health).hitpoints < RAIDER_HP);

    expect(sim.world.get(raider, Health).hitpoints).toBeLessThan(RAIDER_HP); // arrows landed
    expect(sim.world.get(farmer, Health).hitpoints).toBe(RAIDER_HP); // never targeted behind the walls
    expect(insideOf(sim, farmer)).toBe(tower); // and never stepped out to chase
  });

  it('fires from the building itself, one arrow per occupant every 24 ticks', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(12, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const garrison = [settlerAt(sim, 4, 1, P1, FARMER), settlerAt(sim, 4, 2, P1, FARMER)];

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => garrison.every((g) => insideOf(sim, g) === tower));
    const raider = settlerAt(sim, 7, 1, P2, SOLDIER);
    sim.world.mut(raider, Health).max = TOUGH_HP;
    sim.world.mut(raider, Health).hitpoints = TOUGH_HP;

    const shots = collectShots(sim, 2 * SHELTER_SHOT_PERIOD_TICKS);

    // Two people inside are worth two arrows a period, whatever trade they follow and however long its
    // attack clip is - the building aims, they only set its rate.
    expect(shots).toHaveLength(2 * garrison.length);
    for (const shot of shots) {
      expect(shot.source).toBe(tower);
      expect(shot.cover).toBe(tower);
      expect(shot.target).toBe(raider);
    }
    for (const g of garrison) expect(sim.world.tryGet(g, CurrentAtomic)?.effect.kind).not.toBe('attack');
  });

  it('spreads its shots among the enemies near the nearest one', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(12, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const garrison = [settlerAt(sim, 4, 1, P1, FARMER), settlerAt(sim, 4, 2, P1, FARMER)];

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => garrison.every((g) => insideOf(sim, g) === tower));
    const raiders = [6, 7, 8].map((x) => settlerAt(sim, x, 1, P2, SOLDIER));
    for (const r of raiders) sim.world.mut(r, Health).hitpoints = TOUGH_HP;

    const marked = new Set(collectShots(sim, 20 * SHELTER_SHOT_PERIOD_TICKS).map((shot) => shot.target));

    expect(marked.size).toBeGreaterThan(1);
  });

  it('turns on an enemy house in reach when no enemy stands in reach', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(12, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const farmer = settlerAt(sim, 4, 1, P1, FARMER);
    const enemyHouse = buildingAt(sim, 5 + HOUSE_BOW_RANGE / 2, 1, HUT, P2);

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, farmer) === tower);

    const shots = collectShots(sim, 2 * SHELTER_SHOT_PERIOD_TICKS);
    expect(shots.length).toBeGreaterThan(0);
    for (const shot of shots) expect(shot.target).toBe(enemyHouse);
  });

  it("measures its reach from the nearest wall, so no bow outranges a long building's fire", () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(24, 6) });
    const hall = buildingAt(sim, 10, 2, HALL, P1);
    const farmer = settlerAt(sim, 8, 3, P1, FARMER);

    sim.enqueueSetup({ kind: 'setDefenceMode', building: hall, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, farmer) === hall);
    // Two nodes past the east wall, and far past the bow's reach of the hall's centre: an archer standing
    // here measures its own reach to that wall, and so does the hall.
    const raider = settlerAt(sim, 10 + HALL_HALF_LENGTH_NODES / 2 + 1, 2, P2, SOLDIER);

    const shots = collectShots(sim, SHELTER_SHOT_PERIOD_TICKS);
    expect(shots.map((shot) => shot.target)).toEqual([raider]);
  });

  it('picks among the enemies nearest its walls, not its centre', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(24, 6) });
    const hall = buildingAt(sim, 10, 2, HALL, P1);
    const farmer = settlerAt(sim, 8, 3, P1, FARMER);

    sim.enqueueSetup({ kind: 'setDefenceMode', building: hall, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, farmer) === hall);
    // Five marks off the hall's middle, nearer its centre, and one just past the east wall, nearer a wall.
    for (let x = 8; x <= 12; x++) standingMark(sim, x, 0);
    const byTheWall = standingMark(sim, 10 + HALL_HALF_LENGTH_NODES / 2 + 1, 2);

    const marked = collectShots(sim, 20 * SHELTER_SHOT_PERIOD_TICKS).map((shot) => shot.target);
    expect(marked).toContain(byTheWall);
  });

  it('scatters a long shot, which then lands in the dirt instead of on its mark', () => {
    const range = 28;
    const sim = new Simulation({ seed: 1, content: defenceContent(range), map: grass(24, 4) });
    const tower = buildingAt(sim, 3, 1, TOWER, P1);
    const garrison = [settlerAt(sim, 2, 1, P1, FARMER), settlerAt(sim, 2, 2, P1, FARMER)];

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => garrison.every((g) => insideOf(sim, g) === tower));
    standingMark(sim, 3 + range / 2 - 1, 1); // a cell inside the band's far edge

    const landed = { hit: 0, missed: 0 };
    for (let i = 0; i < 40 * SHELTER_SHOT_PERIOD_TICKS; i++) {
      sim.step();
      for (const ev of sim.events.current()) {
        if (ev.kind === 'projectileHit') landed.hit++;
        if (ev.kind === 'projectileMissed') landed.missed++;
      }
    }

    // Most shots land true; a long one sometimes lands a few nodes off and strikes nothing.
    expect(landed.hit).toBeGreaterThan(landed.missed);
    expect(landed.missed).toBeGreaterThan(0);
  });

  it('counts only the settlers that have arrived', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(20, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const inside = settlerAt(sim, 4, 1, P1, FARMER);
    const runner = settlerAt(sim, 15, 1, P1, FARMER); // still crossing the field when the count is read

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, inside) === tower && shelterOf(sim, runner) === tower);

    expect(insideOf(sim, runner)).toBeUndefined();
    expect(shelterOccupancy(sim.world).get(tower)).toBe(1);
  });

  it('never lets a claimant flee - the run for cover is its flight', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(14, 4) });
    const tower = buildingAt(sim, 3, 1, TOWER, P1);
    const farmer = settlerAt(sim, 8, 1, P1, FARMER);
    // A raider in sight from the first tick. A claimant that took the flee drive instead would be steered
    // by the threat rather than by its claim, and it holds a seat the whole time it runs: the tower would
    // report itself full while standing empty.
    settlerAt(sim, 12, 1, P2, SOLDIER);

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
    let fledWhileClaiming = false;
    for (let i = 0; i < 600 && insideOf(sim, farmer) !== tower; i++) {
      sim.step();
      if (sim.world.has(farmer, Sheltering) && sim.world.has(farmer, Fleeing)) fledWhileClaiming = true;
    }

    expect(fledWhileClaiming).toBe(false);
    expect(insideOf(sim, farmer)).toBe(tower);
  });

  it('drops an attack order its garrison cannot walk to instead of staring past the wall', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(14, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const farmer = settlerAt(sim, 4, 1, P1, FARMER);
    const raider = settlerAt(sim, 12, 1, P2, SOLDIER); // past the house bow's band, and never chased

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, farmer) === tower);
    sim.world.add(farmer, AttackOrder, { target: raider });
    sim.step();

    // An order is read straight off the entity by `resolveTarget`, ahead of the shelter's own band. Left
    // standing, it would aim the shooter at a target it can neither reach nor step out to.
    expect(sim.world.has(farmer, AttackOrder)).toBe(false);
    expect(insideOf(sim, farmer)).toBe(tower);
  });

  it('puts a garrison back on the map when its tower is razed under it, without dropping the tick', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(12, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const farmer = settlerAt(sim, 4, 1, P1, FARMER);

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, farmer) === tower);
    sim.world.destroy(tower);
    sim.step();

    expect(sim.world.has(farmer, Sheltering)).toBe(false);
    expect(sim.world.has(farmer, Resting)).toBe(false);
  });

  it('hands a released civilian to the other tower within the same tick the alarm drops', () => {
    // The DefenceSystem sits ahead of the planner for exactly this: the claim is gone before the pass that
    // hands out seats, so the freed settler re-claims on that pass instead of standing idle for a tick.
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(20, 4) });
    const west = buildingAt(sim, 2, 1, TOWER, P1);
    const east = buildingAt(sim, 17, 1, TOWER, P1);
    const farmer = settlerAt(sim, 4, 1, P1, FARMER);

    sim.enqueueSetup({ kind: 'setDefenceMode', building: west, enabled: true });
    sim.enqueueSetup({ kind: 'setDefenceMode', building: east, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, farmer) === west);

    sim.enqueueSetup({ kind: 'setDefenceMode', building: west, enabled: false });
    sim.step(); // ONE tick: the order, the release, and the re-claim

    expect(shelterOf(sim, farmer)).toBe(east);
  });

  it('leaves a civilian outside its work area at work - the alarm does not suspend the signpost rule', () => {
    // Wide enough that the far tower sits past the settler's own reach and past any signpost group it
    // could get to (there are none), so the run for cover is illegal exactly as an errand there would be.
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(100, 4) });
    const near = buildingAt(sim, 3, 1, TOWER, P1);
    const far = buildingAt(sim, 95, 1, TOWER, P1);
    const homebody = settlerAt(sim, 1, 1, P1, FARMER);
    const outlier = settlerAt(sim, 40, 1, P1, FARMER);

    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.enqueueSetup({ kind: 'setDefenceMode', building: near, enabled: true });
    sim.enqueueSetup({ kind: 'setDefenceMode', building: far, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, homebody) === near);

    expect(insideOf(sim, homebody)).toBe(near); // in reach of its own tower - takes cover
    expect(shelterOf(sim, outlier)).toBeUndefined(); // out of reach of both - keeps working
  });

  it('counts a sheltering child toward the fire like anyone inside, and never aims at an enemy child', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(12, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const child = settlerAt(sim, 4, 1, P1, CHILD);
    sim.world.add(child, Age, { ticks: 0 }); // the born-young marker every growing settler carries

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, child) === tower);
    const enemyChild = settlerAt(sim, 6, 1, P2, CHILD);
    sim.world.add(enemyChild, Age, { ticks: 0 });
    const raider = settlerAt(sim, 8, 1, P2, SOLDIER);

    const shots = collectShots(sim, 2 * SHELTER_SHOT_PERIOD_TICKS);

    expect(shots).toHaveLength(2);
    for (const shot of shots) expect(shot.target).toBe(raider);
  });

  it('keeps a starving settler under cover instead of walking it out to eat', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(10, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const farmer = settlerAt(sim, 1, 1, P1, FARMER);

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, farmer) === tower);
    const s = sim.world.mut(farmer, Settler);
    s.hunger = ONE;
    s.fatigue = ONE;
    s.piety = ONE;

    for (let i = 0; i < 200; i++) sim.step();

    expect(insideOf(sim, farmer)).toBe(tower);
  });

  it('lets a sheltering settler eat the food it carries rather than starve holding it', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(10, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const farmer = settlerAt(sim, 1, 1, P1, FARMER);

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, farmer) === tower);
    sim.world.add(farmer, Carrying, { goodType: RATION, amount: 1 });
    sim.world.mut(farmer, Settler).hunger = ONE;

    // Eating takes it nowhere, so it is an answer a settler under cover may give - the alarm only bars
    // the walk to a larder.
    stepUntil(sim, 200, () => sim.world.get(farmer, Settler).hunger < ONE);

    expect(sim.world.get(farmer, Settler).hunger).toBeLessThan(ONE);
    expect(insideOf(sim, farmer)).toBe(tower);
  });
});

describe('shotsDue', () => {
  const overPeriod = (occupants: number): number[] =>
    Array.from({ length: SHELTER_SHOT_PERIOD_TICKS }, (_, tick) => shotsDue(tick, occupants));

  it('is worth one arrow per occupant each period, at most one more than the whole arrows a tick', () => {
    for (const occupants of [0, 2, 23, 24, 30]) {
      const perTick = overPeriod(occupants);
      expect(perTick.reduce((sum, n) => sum + n, 0)).toBe(occupants);
      expect(Math.max(...perTick)).toBeLessThanOrEqual(Math.ceil(occupants / SHELTER_SHOT_PERIOD_TICKS));
    }
  });
});
