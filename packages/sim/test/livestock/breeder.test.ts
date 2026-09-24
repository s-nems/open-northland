import { describe, expect, it } from 'vitest';
import {
  Carrying,
  CurrentAtomic,
  FarmAnimal,
  MoveGoal,
  Position,
  Production,
  Settler,
  Stockpile,
  YoungAnimal,
} from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { Simulation } from '../../src/index.js';
import {
  ANIMAL_ADULT_AGE_TICKS,
  livestockGrowthSystem,
  livestockSummonSystem,
  plannerSystem,
  productionSystem,
} from '../../src/systems/index.js';
import { waterColumnMap } from '../fixtures/terrain.js';
import {
  BREED_TICKS,
  BREEDER_TRACK,
  BREEDER_XP_PER_REPEAT,
  breederAt,
  COW_GOOD,
  cowAt,
  ctxOf,
  DEER_TRIBE,
  farmAt,
  HEADQUARTERS,
  HERD_CAPACITY,
  livestockContent,
  livestockSim,
  MEAT,
  MEAT_CAPACITY,
  SLAY_ATOMIC,
  WATER,
  WHEAT,
  WOOL,
  WOOL_CAPACITY,
} from './support.js';

const P0 = 0;
const FARM_AT = { hx: 20, hy: 20 } as const;

/** A farm with a breeder on its door, and whatever breeding stock the case needs. */
function farmWithBreeder(sim: ReturnType<typeof livestockSim>, stock: Array<[number, number]> = []) {
  const farm = farmAt(sim, FARM_AT.hx, FARM_AT.hy, { owner: P0, stock });
  const breeder = breederAt(sim, FARM_AT.hx, FARM_AT.hy, farm);
  return { farm, breeder };
}

function herdRow(sim: ReturnType<typeof livestockSim>, farm: Entity): number {
  return sim.world.get(farm, Stockpile).amounts.get(COW_GOOD) ?? 0;
}

function plan(sim: ReturnType<typeof livestockSim>): void {
  plannerSystem(sim.world, ctxOf(sim));
}

describe('the breeder cycle - adopt, take, flush, slaughter, breed', () => {
  it('adopts the nearest loose animal of its player and counts it in the herd row', () => {
    const sim = livestockSim();
    const { farm } = farmWithBreeder(sim);
    const far = cowAt(sim, 4, 4, { owner: P0 });
    const near = cowAt(sim, 24, 20, { owner: P0 });

    plan(sim);

    expect(sim.world.tryGet(near, FarmAnimal)?.farm).toBe(farm);
    expect(sim.world.has(far, FarmAnimal)).toBe(false);
    expect(herdRow(sim, farm)).toBe(1);
  });

  it("never adopts another player's animal, nor one already held by a farm", () => {
    const sim = livestockSim();
    const { farm } = farmWithBreeder(sim);
    const other = farmAt(sim, 26, 26, { owner: P0 });
    const foreign = cowAt(sim, 22, 20, { owner: 1 });
    const held = cowAt(sim, 23, 20, { owner: P0, farm: other });

    plan(sim);

    expect(sim.world.has(foreign, FarmAnimal)).toBe(false);
    expect(sim.world.get(held, FarmAnimal).farm).toBe(other);
    expect(herdRow(sim, farm)).toBe(0);
  });

  it('takes an animal off a neighbouring farm that keeps more than the pair, while short of it', () => {
    const sim = livestockSim();
    const { farm } = farmWithBreeder(sim);
    const neighbour = farmAt(sim, 26, 26, { owner: P0 });
    for (let i = 0; i < 3; i++) cowAt(sim, 26 + i, 26, { owner: P0, farm: neighbour });

    plan(sim);

    expect(herdRow(sim, farm)).toBe(1);
    expect(herdRow(sim, neighbour)).toBe(2);
  });

  it('never takes or adopts an animal across water, which could never walk in', () => {
    const sim = new Simulation({ seed: 1, content: livestockContent(), map: waterColumnMap(32, 32, 16) });
    const { farm } = farmWithBreeder(sim);
    const island = farmAt(sim, 44, 20, { owner: P0 });
    const herd = [0, 1, 2].map((i) => cowAt(sim, 44 + i, 24, { owner: P0, farm: island }));
    const stray = cowAt(sim, 40, 20, { owner: P0 });

    plan(sim);

    expect(herd.every((cow) => sim.world.get(cow, FarmAnimal).farm === island)).toBe(true);
    expect(sim.world.has(stray, FarmAnimal)).toBe(false);
    expect(herdRow(sim, farm)).toBe(0);
  });

  it('leaves a neighbour with only a pair alone', () => {
    const sim = livestockSim();
    const { farm } = farmWithBreeder(sim);
    const neighbour = farmAt(sim, 26, 26, { owner: P0 });
    const pair = [0, 1].map((i) => cowAt(sim, 26 + i, 26, { owner: P0, farm: neighbour }));

    plan(sim);

    expect(herdRow(sim, farm)).toBe(0);
    expect(pair.every((cow) => sim.world.get(cow, FarmAnimal).farm === neighbour)).toBe(true);
  });

  it('fetches the feed one unit per trip, however many a cycle eats', () => {
    const sim = livestockSim();
    // Water covered, so the shortfall is the cycle's two wheat - and the trip still brings one.
    const { farm, breeder } = farmWithBreeder(sim, [[WATER, 1]]);
    const hq = farmAt(sim, 24, 24, { owner: P0, buildingType: HEADQUARTERS, stock: [[WHEAT, 8]] });
    sim.world.mut(breeder, Position).x = sim.world.get(hq, Position).x; // standing on the store
    sim.world.mut(breeder, Position).y = sim.world.get(hq, Position).y;
    for (let i = 0; i < 2; i++) cowAt(sim, 21 + i, 20, { owner: P0, farm });

    plan(sim);

    expect(sim.world.get(breeder, CurrentAtomic).effect).toEqual({
      kind: 'pickup',
      goodType: WHEAT,
      amount: 1,
      from: hq,
    });
  });

  it('breeds while exactly the pair stands, and carries the calf into the herd', () => {
    const sim = livestockSim();
    const { farm } = farmWithBreeder(sim, [
      [WATER, 4],
      [WHEAT, 8],
    ]);
    for (let i = 0; i < 2; i++) cowAt(sim, 21 + i, 20, { owner: P0, farm });

    // The breeder takes its seat, the cycle runs out, and the completed batch bears a calf.
    const births: string[] = [];
    for (let i = 0; i < 40; i++) {
      sim.step();
      for (const ev of sim.events.current()) if (ev.kind === 'settlerBorn') births.push(ev.kind);
    }
    // A calf is not a settler being born, so the settlement's birth jingle stays quiet.
    expect(births).toEqual([]);

    const calves = [...sim.world.query(YoungAnimal)];
    expect(calves.length).toBeGreaterThanOrEqual(1);
    const calf = calves[0];
    if (calf === undefined) throw new Error('a calf was expected');
    expect(sim.world.get(calf, FarmAnimal).farm).toBe(farm);
    expect(herdRow(sim, farm)).toBeGreaterThanOrEqual(3);
    // The species row counts the herd, never a good on a shelf: nothing is stocked past the animals.
    expect(herdRow(sim, farm)).toBe([...sim.world.query(FarmAnimal)].length);
  });

  it('weighs both herds against one room, so a full farm breeds neither species', () => {
    const sim = livestockSim();
    const stock: Array<[number, number]> = [
      [WATER, 10],
      [WHEAT, 10],
    ];
    const { farm } = farmWithBreeder(sim, stock);
    // A pair of deer to breed from, and calves of the other species filling the house to one short of
    // its cap. Calves, so no grown animal is over the pair and the cycle reaches the breeding branch.
    for (let i = 0; i < 2; i++) cowAt(sim, 21, 20 + i, { owner: P0, farm, tribe: DEER_TRIBE });
    for (let i = 0; i < HERD_CAPACITY - 3; i++) cowAt(sim, 4, 4, { owner: P0, farm, young: true });

    plan(sim);
    for (let i = 0; i < BREED_TICKS + 2; i++) sim.step();
    expect([...sim.world.query(FarmAnimal)]).toHaveLength(HERD_CAPACITY); // the last place taken

    plan(sim);
    for (let i = 0; i < BREED_TICKS + 2; i++) sim.step();
    expect([...sim.world.query(FarmAnimal)]).toHaveLength(HERD_CAPACITY); // and no calf past it
  });

  it('never breeds with a lone animal, nor once a third has grown up', () => {
    const lone = livestockSim();
    const first = farmWithBreeder(lone, [
      [WATER, 4],
      [WHEAT, 8],
    ]);
    cowAt(lone, 21, 20, { owner: P0, farm: first.farm });

    const crowd = livestockSim();
    const second = farmWithBreeder(crowd, [
      [WATER, 4],
      [WHEAT, 8],
    ]);
    for (let i = 0; i < 3; i++) cowAt(crowd, 21 + i, 20, { owner: P0, farm: second.farm });

    for (const sim of [lone, crowd]) {
      plan(sim);
      productionSystem(sim.world, ctxOf(sim));
    }

    expect(lone.world.tryGet(first.farm, Production)).toBeUndefined();
    expect(crowd.world.tryGet(second.farm, Production)).toBeUndefined();
  });

  it('grows a calf up at the original age, which lets the herd breed on', () => {
    const sim = livestockSim();
    const { farm } = farmWithBreeder(sim);
    const calf = cowAt(sim, 21, 20, { owner: P0, farm });
    sim.world.add(calf, YoungAnimal, { adultAt: ANIMAL_ADULT_AGE_TICKS });

    livestockGrowthSystem(sim.world, { ...ctxOf(sim), tick: ANIMAL_ADULT_AGE_TICKS - 1 });
    expect(sim.world.has(calf, YoungAnimal)).toBe(true);

    livestockGrowthSystem(sim.world, { ...ctxOf(sim), tick: ANIMAL_ADULT_AGE_TICKS });
    expect(sim.world.has(calf, YoungAnimal)).toBe(false);
  });

  it('slaughters past the pair: the breeder walks up to the nearest grown animal', () => {
    const sim = livestockSim();
    const { farm, breeder } = farmWithBreeder(sim);
    const target = cowAt(sim, 28, 20, { owner: P0, farm }); // out of arm's reach of the door
    for (let i = 0; i < 2; i++) cowAt(sim, 4 + i, 4, { owner: P0, farm });

    plan(sim);

    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('livestockSim always has a map');
    expect(sim.world.get(breeder, MoveGoal).cell).toBe(terrain.nodeAt(28, 20));
    expect(sim.world.get(target, FarmAnimal).summoner).toBeNull();
  });

  it('takes an animal in hand from two map points away, and the summon walks it to the door', () => {
    const sim = livestockSim();
    const { farm, breeder } = farmWithBreeder(sim);
    const target = cowAt(sim, FARM_AT.hx + 2, FARM_AT.hy, { owner: P0, farm });
    for (let i = 0; i < 2; i++) cowAt(sim, 4 + i, 4, { owner: P0, farm });

    plan(sim);
    expect(sim.world.get(target, FarmAnimal).summoner).toBe(breeder);

    livestockSummonSystem(sim.world, ctxOf(sim));
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('livestockSim always has a map');
    expect(sim.world.get(target, MoveGoal).cell).toBe(terrain.nodeAt(FARM_AT.hx, FARM_AT.hy));
  });

  it('never leads away an animal a colleague already has in hand, nor one that keeps the pair', () => {
    const sim = livestockSim();
    const { farm, breeder } = farmWithBreeder(sim);
    const colleague = breederAt(sim, FARM_AT.hx, FARM_AT.hy + 1, farm);
    const held = cowAt(sim, FARM_AT.hx + 2, FARM_AT.hy, { owner: P0, farm });
    for (let i = 0; i < 2; i++) cowAt(sim, 4 + i, 4, { owner: P0, farm });
    sim.world.mut(held, FarmAnimal).summoner = colleague;

    plan(sim);

    // Only three animals stand, one of them already being led away: nothing is left over the pair.
    expect(sim.world.get(held, FarmAnimal).summoner).toBe(colleague);
    expect(sim.world.has(breeder, MoveGoal)).toBe(false);
  });

  it("sets both of a farm's breeders to work, each leading its own animal away", () => {
    const sim = livestockSim();
    const { farm, breeder } = farmWithBreeder(sim);
    const colleague = breederAt(sim, FARM_AT.hx, FARM_AT.hy, farm);
    const herd = [0, 1, 2, 3].map((i) => cowAt(sim, FARM_AT.hx + 1, FARM_AT.hy + i, { owner: P0, farm }));

    plan(sim);

    // Four grown animals leave two over the pair, and the pair of breeders takes one each.
    const summoners = herd.map((a) => sim.world.get(a, FarmAnimal).summoner).filter((s) => s !== null);
    expect(new Set(summoners)).toEqual(new Set([breeder, colleague]));
  });

  it('kills the summoned animal on the door tile and banks the clip’s wares in the farm', () => {
    const sim = livestockSim();
    const { farm, breeder } = farmWithBreeder(sim);
    const doomed = cowAt(sim, FARM_AT.hx, FARM_AT.hy, { owner: P0, farm });
    for (let i = 0; i < 2; i++) cowAt(sim, 4 + i, 4, { owner: P0, farm });
    sim.world.mut(doomed, FarmAnimal).summoner = breeder;

    plan(sim); // both stand on the door: the knife comes out
    expect(sim.world.isAlive(doomed)).toBe(false);
    expect(sim.world.get(breeder, CurrentAtomic).atomicId).toBe(SLAY_ATOMIC);
    expect(herdRow(sim, farm)).toBe(2);

    for (let i = 0; i < 20; i++) sim.step();

    const stock = sim.world.get(farm, Stockpile).amounts;
    expect(stock.get(WOOL)).toBe(1);
    expect(stock.get(MEAT)).toBe(2);
  });

  it("pays the slaughterer's experience into the wares the clip banks", () => {
    const sim = livestockSim();
    const { farm, breeder } = farmWithBreeder(sim);
    const doomed = cowAt(sim, FARM_AT.hx, FARM_AT.hy, { owner: P0, farm });
    for (let i = 0; i < 2; i++) cowAt(sim, 4 + i, 4, { owner: P0, farm });
    sim.world.mut(doomed, FarmAnimal).summoner = breeder;
    // Far past mastery, so the curve tops out and every ware the clip banks comes twice.
    sim.world.mut(breeder, Settler).experience.set(BREEDER_TRACK, 200 * BREEDER_XP_PER_REPEAT);

    plan(sim);
    for (let i = 0; i < 20; i++) sim.step();

    const stock = sim.world.get(farm, Stockpile).amounts;
    expect(stock.get(WOOL)).toBe(2); // one fleece off the animal, one off the hand that skinned it
    expect(stock.get(MEAT)).toBe(MEAT_CAPACITY); // 4 cuts earned, the shelf holds 3 and banks the rest
  });

  it('carries a full ware out before it slaughters again', () => {
    const sim = livestockSim();
    const { farm, breeder } = farmWithBreeder(sim, [[WOOL, WOOL_CAPACITY]]);
    farmAt(sim, 24, 24, { owner: P0, buildingType: HEADQUARTERS, stock: [[WOOL, 0]] });
    for (let i = 0; i < 3; i++) cowAt(sim, 21 + i, 20, { owner: P0, farm });

    plan(sim);
    for (let i = 0; i < 6; i++) sim.step();

    // The fleece left the farm on the breeder's back rather than a fourth animal dying into a full shelf.
    const carried = sim.world.tryGet(breeder, Carrying);
    const moved = (sim.world.get(farm, Stockpile).amounts.get(WOOL) ?? 0) < WOOL_CAPACITY;
    expect(carried?.goodType === WOOL || moved).toBe(true);
    expect([...sim.world.query(FarmAnimal)]).toHaveLength(3);
  });
});
