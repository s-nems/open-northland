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
import { garrisonSeats } from '../../src/systems/defence/index.js';
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
const HUNTER = 15; // `hunter` - a civilian trade that shelters, but whose filter also admits game
const DEER = 9; // an animal tribe with a huntPrey row: game a hunter may strike, and nobody else may
const TOWER = 40;
const HUT = 41; // no shelterCapacity: a building that cannot raise the alarm at all

const TOWER_CAPACITY = 2;
const HOUSE_BOW_DAMAGE = 30;
const HOUSE_BOW_RANGE = 6;
const RAIDER_HP = 500;
/** Game deep enough to outlive a long window, so the band under test never changes shape mid-run. */
const GAME_HP = 100_000;
/** A food good, so a settler under cover can answer hunger from what it carries. */
const RATION = 1;
/** The deer's carcass good; huntPrey yields need a harvest atomic. */
const VENISON = 2;

/** One tribe fought across two players, a tower that shelters {@link TOWER_CAPACITY} civilians and a hut
 *  that shelters nobody, the civilian house bow (bound by id, no jobType - a sheltering settler keeps its
 *  own trade and wears the bow), and a short-range raider mace. */
function defenceContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: RATION, id: 'food_simple', weight: 1 },
      { typeId: VENISON, id: 'food_venison', weight: 1, atomics: { harvest: 32 } },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: CHILD, id: 'child_male' },
      { typeId: FARMER, id: 'farmer' },
      { typeId: HUNTER, id: 'hunter' },
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
        munitionType: 1, // an arrow, like the extracted row - so a garrison shot really is a projectile
        speed: 7,
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
          { jobType: HUNTER, atomicId: 81, animation: 'viking_attack' },
          { jobType: SOLDIER, atomicId: 81, animation: 'viking_attack' },
        ],
      },
      { typeId: DEER, id: 'deer' },
    ],
    animals: [{ id: 'deer', tribeType: DEER, catchable: true, hitpointsAdult: 1000 }],
    huntPrey: [{ tribeType: DEER, yields: [{ goodType: VENISON, amount: 1 }] }],
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
  addPerson(sim.world, e, {
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

/** Wildlife: a positioned, {@link Health}-bearing settler of an animal tribe, owned by nobody. It carries
 *  no stay point, so it neither roams nor is frightened off the node it is placed on. */
function animalAt(sim: Simulation, x: number, y: number, tribe: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, { x: fx.fromInt(x), y: fx.fromInt(y) });
  addPerson(sim.world, e, {
    tribe,
    jobType: null,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Health, { hitpoints: GAME_HP, max: GAME_HP });
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

  it('looses the garrison arrow from the tower, not from the door node the shooter stands on', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(12, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const farmer = settlerAt(sim, 4, 1, P1, FARMER);

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, farmer) === tower);
    // A settler keeps the cell it entered by, and a real building's door sits off its anchor - this
    // fixture has no footprint, so the two coincide until the shooter is stood one cell off by hand.
    const doorstep = { x: fx.fromInt(4), y: fx.fromInt(1) };
    sim.world.add(farmer, Position, doorstep);
    settlerAt(sim, 7, 1, P2, SOLDIER); // the mark, in bow reach of the tower

    let shot: Entity | undefined;
    stepUntil(sim, 600, () => {
      shot = [...sim.world.query(Projectile)][0];
      return shot !== undefined;
    });
    if (shot === undefined) throw new Error('expected the garrison to loose an arrow');

    // The arrow leaves the TOWER, not the shooter's cell - the render then draws it falling from the
    // tower's gallery instead of climbing off the ground beside it.
    const at = sim.world.get(tower, Position);
    expect(at).not.toEqual(doorstep);
    expect(sim.world.get(shot, Projectile).cover).toBe(tower);
    expect(sim.world.get(shot, Position)).toEqual({ x: at.x, y: at.y });
  });

  it('measures a garrison’s reach from the tower too, not from the cell the shooter stands on', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(16, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const farmer = settlerAt(sim, 4, 1, P1, FARMER);

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, farmer) === tower);
    // Stand the shooter far off the tower (the door-vs-anchor gap a footprinted building really has,
    // exaggerated): the mark below is HOUSE_BOW_RANGE nodes from the tower and far outside that band from
    // the shooter's own cell, so an arrow proves the tower is what aims.
    sim.world.add(farmer, Position, { x: fx.fromInt(1), y: fx.fromInt(1) });
    settlerAt(sim, 5 + HOUSE_BOW_RANGE / 2, 1, P2, SOLDIER);

    stepUntil(sim, 600, () => [...sim.world.query(Projectile)].length > 0);

    expect(insideOf(sim, farmer)).toBe(tower); // still under cover, so it shot from in there
    expect([...sim.world.query(Projectile)]).not.toHaveLength(0);
  });

  it('fans the garrison across the nearest raiders instead of stacking it all on one', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(12, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const first = settlerAt(sim, 4, 1, P1, FARMER);
    // A gap in the entity ids, as a real village has: what divides the band between the two shooters is
    // their SEAT in the garrison, not their id. With a gap of 6 and three marks below, an id-derived
    // offset would land both on the same man.
    for (let i = 0; i < 5; i++) sim.world.create();
    const garrison = [first, settlerAt(sim, 4, 2, P1, FARMER)];

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => garrison.every((g) => insideOf(sim, g) === tower));
    // Three marks at three distances, all inside the bow's band: a garrison that always took the nearest
    // would put every arrow of every tick into the same man.
    for (const x of [6, 7, 8]) settlerAt(sim, x, 1, P2, SOLDIER);

    let split = false;
    for (let i = 0; i < 600 && !split; i++) {
      sim.step();
      const drawn = garrison.map((g) => {
        const swing = sim.world.tryGet(g, CurrentAtomic)?.effect;
        return swing?.kind === 'attack' ? swing.target : null;
      });
      split = drawn.every((t) => t !== null) && new Set(drawn).size === garrison.length;
    }

    expect(split).toBe(true); // both shooters drew on DIFFERENT raiders in the same tick
  });

  it('keeps a sheltering hunter’s game out of the trade sitting beside it', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(12, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const hunter = settlerAt(sim, 4, 1, P1, HUNTER); // the lower id, so it takes seat 0 and resolves first
    const farmer = settlerAt(sim, 4, 2, P1, FARMER);

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, hunter) === tower && insideOf(sim, farmer) === tower);
    // Two heads of game in the bow's band, which only the hunter's predation filter admits, and an enemy
    // house, which only the deprioritized tier holds. The two occupants share a node, a band and a reach,
    // so the whole difference between their searches is the trade the filter keys on.
    const nearGame = animalAt(sim, 6, 1, DEER);
    animalAt(sim, 7, 1, DEER); // the second head - what seat 1 would take from a band it must not share
    const enemyHouse = buildingAt(sim, 5 + HOUSE_BOW_RANGE / 2, 1, HUT, P2);

    const drawnBy = (e: Entity): Entity | null => {
      const swing = sim.world.tryGet(e, CurrentAtomic)?.effect;
      return swing?.kind === 'attack' ? swing.target : null;
    };
    const hunterDrew = new Set<Entity>();
    const farmerDrew = new Set<Entity>();
    for (let i = 0; i < 600; i++) {
      sim.step();
      const game = drawnBy(hunter);
      const house = drawnBy(farmer);
      if (game !== null) hunterDrew.add(game);
      if (house !== null) farmerDrew.add(house);
    }

    expect(hunterDrew).toEqual(new Set([nearGame])); // seat 0 takes the nearest of its own band
    expect(farmerDrew).toEqual(new Set([enemyHouse])); // and seat 1 never inherits a head of it
  });

  it('seats only the settlers that have arrived, so the spread never doubles up on one raider', () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(20, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const inside = settlerAt(sim, 4, 1, P1, FARMER);
    const runner = settlerAt(sim, 15, 1, P1, FARMER); // still crossing the field when the seats are read

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, inside) === tower && shelterOf(sim, runner) === tower);

    // Seats number the ARRIVED. Counting the runner would leave the seats in play {0, 2, ...} - a sparse
    // set that collides again the moment the spread takes them modulo the band.
    const seats = garrisonSeats(sim.world);
    expect(seats.get(inside)).toBe(0);
    expect(seats.has(runner)).toBe(false);
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
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(60, 4) });
    const near = buildingAt(sim, 3, 1, TOWER, P1);
    const far = buildingAt(sim, 55, 1, TOWER, P1);
    const homebody = settlerAt(sim, 1, 1, P1, FARMER);
    const outlier = settlerAt(sim, 30, 1, P1, FARMER);

    sim.enqueueSetup({ kind: 'setSignpostNavigation', enabled: true });
    sim.enqueueSetup({ kind: 'setDefenceMode', building: near, enabled: true });
    sim.enqueueSetup({ kind: 'setDefenceMode', building: far, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, homebody) === near);

    expect(insideOf(sim, homebody)).toBe(near); // in reach of its own tower - takes cover
    expect(shelterOf(sim, outlier)).toBeUndefined(); // out of reach of both - keeps working
  });

  it("hides a child without arming it - the bow is the grown civilians'", () => {
    const sim = new Simulation({ seed: 1, content: defenceContent(), map: grass(12, 4) });
    const tower = buildingAt(sim, 5, 1, TOWER, P1);
    const child = settlerAt(sim, 4, 1, P1, CHILD);
    sim.world.add(child, Age, { ticks: 0 }); // the born-young marker every growing settler carries

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
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

    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
    stepUntil(sim, 400, () => insideOf(sim, farmer) === tower);
    sim.world.write(farmer, Settler, (s) => {
      s.hunger = ONE;
      s.fatigue = ONE;
      s.piety = ONE;
    });

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
    sim.world.write(farmer, Settler, (s) => {
      s.hunger = ONE;
    });

    // Eating takes it nowhere, so it is an answer a settler under cover may give - the alarm only bars
    // the walk to a larder.
    stepUntil(sim, 200, () => sim.world.get(farmer, Settler).hunger < ONE);

    expect(sim.world.get(farmer, Settler).hunger).toBeLessThan(ONE);
    expect(insideOf(sim, farmer)).toBe(tower);
  });
});
