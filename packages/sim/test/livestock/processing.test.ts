import { describe, expect, it } from 'vitest';
import {
  CraftSelection,
  Health,
  LivestockVisit,
  MoveGoal,
  Position,
  Production,
  Resting,
  StayPoint,
  Stockpile,
} from '../../src/components/index.js';
import { positionOfNode, type Simulation } from '../../src/index.js';
import {
  beginCycle,
  canStartCycle,
  depositCycleOutput,
} from '../../src/systems/economy/production/cycles.js';
import {
  LIVESTOCK_MIN_LIFE_DIVISOR,
  LIVESTOCK_PROCESS_DRAIN_HP,
  livestockVisitSystem,
  productionSystem,
  startableCycleCount,
} from '../../src/systems/index.js';
import { recipesByProductOf } from '../../src/systems/stores/index.js';
import { settlerAt } from '../fixtures/settler.js';
import {
  breederAt,
  COW_GOOD,
  COW_HP,
  cowAt,
  ctxOf,
  FEED_TICKS,
  farmAt,
  livestockSim,
  MEAT,
  MEAT_CAPACITY,
  WATER,
  WHEAT,
  WOOL,
} from './support.js';

const P0 = 0;
const P1 = 1;

/** A farm stocked for two feed batches, anchored on node (10, 10) - its door/interaction node - with
 *  one breeder on station (the summon requires a spare operator seat). */
function stockedFarm(sim: Simulation, opts: { owner?: number } = {}) {
  const farm = farmAt(sim, 10, 10, {
    stock: [
      [WATER, 2],
      [WHEAT, 4],
    ],
    ...opts,
  });
  const breeder = breederAt(sim, 10, 10);
  const ctx = ctxOf(sim);
  const recipes = recipesByProductOf(sim.world, ctx, farm);
  if (recipes === undefined) throw new Error('fixture farm always has recipes');
  const feed = recipes.get(COW_GOOD);
  if (feed === undefined) throw new Error('fixture farm always has the feed recipe');
  return { farm, breeder, ctx, recipes, feed };
}

describe('livestock processing - the visit: summon, arrive, enter with the batch, pay on release', () => {
  it('starts nothing without an animal, despite stocked inputs', () => {
    const sim = livestockSim();
    const { farm, ctx, feed } = stockedFarm(sim);
    expect(startableCycleCount(sim.world, ctx, farm, feed)).toBe(0);
  });

  it('summons a grazing animal to the door; no batch may start until it arrives', () => {
    const sim = livestockSim();
    const { farm, ctx, feed } = stockedFarm(sim);
    const grazing = cowAt(sim, 14, 10); // penned, away from the door

    livestockVisitSystem(sim.world, ctx);

    expect(sim.world.tryGet(grazing, LivestockVisit)?.at).toBe(farm);
    expect(sim.world.has(grazing, MoveGoal)).toBe(true); // walking to the door
    expect(startableCycleCount(sim.world, ctx, farm, feed)).toBe(0); // not arrived yet
  });

  it('an arrived animal opens the batch; only one waits per species at a time', () => {
    const sim = livestockSim();
    const { farm, ctx, feed } = stockedFarm(sim);
    const atDoor = cowAt(sim, 10, 10);
    const spare = cowAt(sim, 11, 10);

    livestockVisitSystem(sim.world, ctx);
    livestockVisitSystem(sim.world, ctx);

    expect(sim.world.has(atDoor, LivestockVisit)).toBe(true);
    expect(sim.world.has(spare, LivestockVisit)).toBe(false); // the queue is one animal deep
    expect(startableCycleCount(sim.world, ctx, farm, feed)).toBe(1);
  });

  it('never summons an animal the drain would leave under half its pool', () => {
    const sim = livestockSim();
    const { farm, ctx, feed } = stockedFarm(sim);
    // 700 - 250 = 450 < 500: one visit would breach the floor.
    const worn = cowAt(sim, 10, 10, { hp: COW_HP / 2 + LIVESTOCK_PROCESS_DRAIN_HP - 50 });

    livestockVisitSystem(sim.world, ctx);

    expect(sim.world.has(worn, LivestockVisit)).toBe(false);
    expect(startableCycleCount(sim.world, ctx, farm, feed)).toBe(0);
  });

  it('never summons an animal outside the pen radius, nor to a starved farm', () => {
    const sim = livestockSim();
    const { ctx } = stockedFarm(sim);
    const far = cowAt(sim, 50, 40); // Manhattan 70 from the door
    livestockVisitSystem(sim.world, ctx);
    expect(sim.world.has(far, LivestockVisit)).toBe(false);

    const starvedSim = livestockSim();
    farmAt(starvedSim, 10, 10); // no water/wheat stocked
    const near = cowAt(starvedSim, 10, 10);
    livestockVisitSystem(starvedSim.world, ctxOf(starvedSim));
    expect(starvedSim.world.has(near, LivestockVisit)).toBe(false);
  });

  it("an owned farm summons only its own player's stock - never wild or enemy animals", () => {
    const sim = livestockSim();
    const { ctx } = stockedFarm(sim, { owner: P0 });
    const wild = cowAt(sim, 11, 10);
    const enemy = cowAt(sim, 12, 10, { owner: P1 });
    const own = cowAt(sim, 13, 10, { owner: P0 });

    livestockVisitSystem(sim.world, ctx);

    expect(sim.world.has(wild, LivestockVisit)).toBe(false);
    expect(sim.world.has(enemy, LivestockVisit)).toBe(false);
    expect(sim.world.has(own, LivestockVisit)).toBe(true);
  });

  it('summons the healthiest animal first (canonical pick)', () => {
    const sim = livestockSim();
    const { ctx } = stockedFarm(sim);
    const worn = cowAt(sim, 11, 10, { hp: COW_HP - 100 });
    const fresh = cowAt(sim, 12, 10);

    livestockVisitSystem(sim.world, ctx);

    expect(sim.world.has(fresh, LivestockVisit)).toBe(true);
    expect(sim.world.has(worn, LivestockVisit)).toBe(false);
  });

  it('beginCycle steps the arrived animal INSIDE; inputs are consumed, the life cost waits', () => {
    const sim = livestockSim();
    const { farm, ctx, feed } = stockedFarm(sim);
    const cow = cowAt(sim, 10, 10); // standing on the door
    livestockVisitSystem(sim.world, ctx);

    beginCycle(sim.world, ctx, farm, feed, COW_GOOD);

    expect(sim.world.tryGet(cow, Resting)?.at).toBe(farm); // entered with the batch
    expect(sim.world.has(cow, MoveGoal)).toBe(false);
    expect(sim.world.get(cow, Health).hitpoints).toBe(COW_HP);
    const stock = sim.world.get(farm, Stockpile).amounts;
    expect(stock.get(WATER)).toBe(1);
    expect(stock.get(WHEAT)).toBe(2);
    expect(sim.world.get(farm, Production).cycles).toHaveLength(1);
  });

  it('an admitted animal closes the gate - a lone animal caps the farm at one batch', () => {
    const sim = livestockSim();
    const { farm, ctx, feed } = stockedFarm(sim); // stocked for two batches
    cowAt(sim, 10, 10);
    livestockVisitSystem(sim.world, ctx);

    beginCycle(sim.world, ctx, farm, feed, COW_GOOD);
    expect(startableCycleCount(sim.world, ctx, farm, feed)).toBe(0);
    beginCycle(sim.world, ctx, farm, feed, COW_GOOD);

    expect(sim.world.get(farm, Production).cycles).toHaveLength(1);
  });

  it('a demolished workplace drops its visitors where they stand', () => {
    const sim = livestockSim();
    const { farm, ctx, feed } = stockedFarm(sim);
    const cow = cowAt(sim, 10, 10);
    livestockVisitSystem(sim.world, ctx);
    beginCycle(sim.world, ctx, farm, feed, COW_GOOD); // inside

    sim.world.destroy(farm);
    livestockVisitSystem(sim.world, ctx);

    expect(sim.world.has(cow, LivestockVisit)).toBe(false);
    expect(sim.world.has(cow, Resting)).toBe(false);
  });

  it('the completing batch releases the INSIDE visitor with a floor-clamped life cost', () => {
    const sim = livestockSim();
    const { farm, ctx, recipes, feed } = stockedFarm(sim);
    const cow = cowAt(sim, 10, 10);
    livestockVisitSystem(sim.world, ctx);
    beginCycle(sim.world, ctx, farm, feed, COW_GOOD);
    // Its HP moved since admission (a fight): the release drain must stop at the floor, not cross it.
    const floor = Math.floor(COW_HP / LIVESTOCK_MIN_LIFE_DIVISOR);
    sim.world.write(cow, Health, (h) => {
      h.hitpoints = floor + 100;
    });

    const cycle = { elapsed: FEED_TICKS, duration: FEED_TICKS, goodType: COW_GOOD };
    depositCycleOutput(sim.world, ctx, farm, cycle, recipes);

    expect(sim.world.get(cow, Health).hitpoints).toBe(floor);
    expect(sim.world.has(cow, LivestockVisit)).toBe(false);
    expect(sim.world.has(cow, Resting)).toBe(false);
  });

  it('the successor waits for the release AND the token conversion - the doorway stays empty', () => {
    const sim = livestockSim();
    const { farm, ctx, recipes, feed } = stockedFarm(sim);
    const inside = cowAt(sim, 10, 10);
    const next = cowAt(sim, 14, 10);
    const terrain = sim.terrain;
    if (terrain === undefined) throw new Error('livestockSim always has a map');
    const spot = terrain.nodeAt(14, 14);
    sim.world.add(inside, StayPoint, { cell: spot });
    livestockVisitSystem(sim.world, ctx); // summons the door-stander (healthiest tie -> lowest id)
    beginCycle(sim.world, ctx, farm, feed, COW_GOOD); // admits it

    livestockVisitSystem(sim.world, ctx); // batch grinding: the species slot is TAKEN, nobody queues
    expect(sim.world.has(next, LivestockVisit)).toBe(false);

    const cycle = { elapsed: FEED_TICKS, duration: FEED_TICKS, goodType: COW_GOOD };
    depositCycleOutput(sim.world, ctx, farm, cycle, recipes);
    expect(sim.world.has(inside, LivestockVisit)).toBe(false); // paid and left...
    expect(sim.world.get(inside, Health).hitpoints).toBe(COW_HP - LIVESTOCK_PROCESS_DRAIN_HP);
    expect(sim.world.tryGet(inside, MoveGoal)?.cell).toBe(spot); // ...straight back to its grazing spot

    // Seat free again (the batch list is cleared), but the deposited token still awaits conversion:
    // the next feed is not the seat's next batch, so nobody is called to the door yet.
    sim.world.remove(farm, Production);
    livestockVisitSystem(sim.world, ctx);
    expect(sim.world.has(next, LivestockVisit)).toBe(false);

    // Token converted: the backlog is drained and the successor is called.
    sim.world.get(farm, Stockpile).amounts.set(COW_GOOD, 0);
    livestockVisitSystem(sim.world, ctx);
    expect(sim.world.tryGet(next, LivestockVisit)?.at).toBe(farm);
    expect(sim.world.get(next, Health).hitpoints).toBe(COW_HP);
  });

  it('summons only for a spare operator seat - a deserted or fully busy farm calls nobody', () => {
    const sim = livestockSim();
    // Deserted: stocked inputs, an eligible cow, but no breeder on station.
    const farm = farmAt(sim, 10, 10, {
      stock: [
        [WATER, 2],
        [WHEAT, 4],
      ],
    });
    const ctx = ctxOf(sim);
    const cow = cowAt(sim, 14, 10);
    livestockVisitSystem(sim.world, ctx);
    expect(sim.world.has(cow, LivestockVisit)).toBe(false);

    // Staffed, but the lone seat is grinding a batch: still nobody is called mid-batch.
    breederAt(sim, 10, 10);
    sim.world.add(farm, Production, {
      cycles: [{ elapsed: 0, duration: FEED_TICKS, goodType: WOOL }],
    });
    livestockVisitSystem(sim.world, ctx);
    expect(sim.world.has(cow, LivestockVisit)).toBe(false);

    // The batch done, the seat spare: the walk to the door finally starts.
    sim.world.remove(farm, Production);
    livestockVisitSystem(sim.world, ctx);
    expect(sim.world.tryGet(cow, LivestockVisit)?.at).toBe(farm);
  });

  it('never summons for a chain whose converter is tech-locked - no batch is worth the life', () => {
    // WOOL locked behind a job nobody holds (the fixture twin of the real hunter→leather gate): the
    // token's only consumer can't start, so feeding would strand the token and waste the cow's life.
    const WOOL_GATE_JOB = 99;
    const sim = livestockSim({ woolGateJob: WOOL_GATE_JOB });
    farmAt(sim, 10, 10, {
      stock: [
        [WATER, 2],
        [WHEAT, 4],
      ],
    });
    breederAt(sim, 10, 10);
    const ctx = ctxOf(sim);
    const cow = cowAt(sim, 14, 10);

    livestockVisitSystem(sim.world, ctx);
    expect(sim.world.has(cow, LivestockVisit)).toBe(false);

    // The enabling settler appears: the chain is convertible again and the summon resumes.
    settlerAt(sim, { jobType: WOOL_GATE_JOB, position: positionOfNode(5, 5) });
    livestockVisitSystem(sim.world, ctx);
    expect(sim.world.has(cow, LivestockVisit)).toBe(true);
  });

  it('a spare seat waits for its walking animal instead of starting a conversion batch', () => {
    const sim = livestockSim();
    const { farm, ctx } = stockedFarm(sim);
    const walking = cowAt(sim, 14, 10); // summoned below, still four nodes from the door
    sim.world.get(farm, Stockpile).amounts.set(COW_GOOD, 1); // a token the rotation could convert
    sim.world.add(walking, LivestockVisit, { at: farm });

    productionSystem(sim.world, ctx);
    // The seat is held for the walker: no batch of any kind begins.
    expect(sim.world.has(farm, Production)).toBe(false);

    // The animal reaches the door: the very next pass starts ITS feed, not the token conversion.
    const at = sim.world.get(walking, Position);
    const door = positionOfNode(10, 10);
    at.x = door.x;
    at.y = door.y;
    productionSystem(sim.world, ctx);
    expect(sim.world.get(farm, Production).cycles.map((c) => c.goodType)).toEqual([COW_GOOD]);
    expect(sim.world.tryGet(walking, Resting)?.at).toBe(farm);
  });

  it('a walking visitor whose inputs vanished stops holding its seat - the operator converts', () => {
    const sim = livestockSim();
    const { farm, ctx } = stockedFarm(sim);
    const walking = cowAt(sim, 14, 10);
    sim.world.add(walking, LivestockVisit, { at: farm });
    const stock = sim.world.get(farm, Stockpile).amounts;
    stock.set(COW_GOOD, 1); // a token the rotation can convert
    stock.set(WATER, 0); // the feed's inputs are gone mid-walk
    stock.set(WHEAT, 0);

    productionSystem(sim.world, ctx);

    // No seat is held for a feed that cannot start: the wool conversion runs instead, and the
    // visitor waits out the refetch at the door.
    expect(sim.world.get(farm, Production).cycles.map((c) => c.goodType)).toEqual([WOOL]);
    expect(sim.world.has(walking, LivestockVisit)).toBe(true);
  });

  it('a completed feed cycle deposits its product plus one meat, forfeited on a full shelf', () => {
    const sim = livestockSim();
    const { farm, ctx, recipes } = stockedFarm(sim);
    const cycle = { elapsed: FEED_TICKS, duration: FEED_TICKS, goodType: COW_GOOD };

    depositCycleOutput(sim.world, ctx, farm, cycle, recipes);
    const stock = sim.world.get(farm, Stockpile).amounts;
    expect(stock.get(COW_GOOD)).toBe(1);
    expect(stock.get(MEAT)).toBe(1);

    depositCycleOutput(sim.world, ctx, farm, cycle, recipes);
    depositCycleOutput(sim.world, ctx, farm, cycle, recipes);
    expect(sim.world.get(farm, Stockpile).amounts.get(MEAT)).toBe(MEAT_CAPACITY); // the third is forfeited
  });

  it('the conversion recipe (fed-cow → wool) needs no live animal', () => {
    const sim = livestockSim();
    const farm = farmAt(sim, 10, 10, { stock: [[COW_GOOD, 1]] });
    const ctx = ctxOf(sim);
    const recipes = recipesByProductOf(sim.world, ctx, farm);
    const convert = recipes?.get(WOOL);
    if (convert === undefined) throw new Error('fixture farm always has the wool recipe');
    expect(canStartCycle(sim.world, ctx, farm, convert)).toBe(true);
  });

  it('a wool-only craft selection still runs the feed stage (the token recipe is implied)', () => {
    const sim = livestockSim();
    const { farm, breeder, ctx } = stockedFarm(sim);
    cowAt(sim, 10, 10);
    sim.world.add(breeder, CraftSelection, { goods: [WOOL], cursor: 0 });

    for (let i = 0; i <= 2 * (FEED_TICKS + 1) + 2; i++) {
      livestockVisitSystem(sim.world, ctx);
      productionSystem(sim.world, ctx);
    }

    expect(sim.world.get(farm, Stockpile).amounts.get(WOOL)).toBeGreaterThanOrEqual(1);
  });

  it('a staffed farm turns water+wheat and cow life into wool and meat through the system loop', () => {
    const sim = livestockSim();
    const { farm, ctx } = stockedFarm(sim); // one breeder on the interaction node runs the craft
    const cow = cowAt(sim, 10, 10); // grazing on the door node - summoned and admitted in place

    // One operator runs the chain serially: feed (10 ticks, the cow inside, drained on release,
    // +1 meat byproduct), then the rotation converts the fed-cow good to wool (10 more).
    for (let i = 0; i <= 2 * (FEED_TICKS + 1) + 2; i++) {
      livestockVisitSystem(sim.world, ctx);
      productionSystem(sim.world, ctx);
    }

    const stock = sim.world.get(farm, Stockpile).amounts;
    expect(stock.get(WOOL)).toBeGreaterThanOrEqual(1);
    expect(stock.get(MEAT)).toBeGreaterThanOrEqual(1);
    expect(sim.world.get(cow, Health).hitpoints).toBeLessThan(COW_HP);
    // The floor held throughout: the drain never took the cow under half its pool.
    expect(sim.world.get(cow, Health).hitpoints).toBeGreaterThanOrEqual(COW_HP / 2);
  });
});
