import { type ContentSet, parseContentSet } from '@open-northland/data';
import { Building, Health, Livestock, Owner, Position, Stockpile } from '../../src/components/index.js';
import type { Entity } from '../../src/ecs/world.js';
import { ONE, positionOfNode, Simulation } from '../../src/index.js';
import { isCatchableAnimal } from '../../src/systems/readviews/index.js';
import { combatContent } from '../fixtures/content/combat.js';
import { economyContent } from '../fixtures/content/economy.js';
import { TEST_MANIFEST } from '../fixtures/content/index.js';
import { societyContent } from '../fixtures/content/societies.js';
import { settlerAt } from '../fixtures/settler.js';
import { grassCellMap } from '../fixtures/terrain.js';

export { ctxOf } from '../fixtures/context.js';

// The husbandry fixture: the shared synthetic content plus the livestock slice - a fed-cow good
// slug-joined to the societies fixture's catchable `test_cow` tribe, and an animal farm whose
// recipes mirror the extracted shape (feed: water+wheat → fed-cow; convert: fed-cow → wool;
// slaughter: nothing → meat, which the recipe table must DROP).

/** The societies fixture's catchable cow (tribe 13, `test_cow`, 1000 HP adult). */
export const COW_TRIBE = 13;
export const COW_HP = 1000;
/** An animal tribe that is NOT catchable (the aggressive bear) - the capture counter-case. */
export const BEAR_TRIBE = 10;
/** The fed-cow good - its id `test_cow` is the slug join to {@link COW_TRIBE}. */
export const COW_GOOD = 57;
export const WOOL = 58;
/** The byproduct target - the economy fixture's meat; its `meat` slug is what resolves it. */
export const MEAT = 21;
export const WATER = 55;
/** The economy fixture's wheat (typeId 6). */
export const WHEAT = 6;
export const BREEDER = 16;
/** The economy fixture's scout (job 27). */
export const SCOUT = 27;
export const FARM = 30;
/** The economy fixture's headquarters (typeId 1, id `headquarters`). */
export const HEADQUARTERS = 1;
export const FEED_TICKS = 10;
/** Deliberately tiny meat shelf, so the byproduct's full-shelf forfeit is testable. */
export const MEAT_CAPACITY = 2;

/** Options threaded into the fixture content: `woolGateJob` adds a `jobEnablesGood` edge locking WOOL
 *  behind that job being alive - the fixture twin of the real hunter→leather gate. */
export interface LivestockContentOptions {
  readonly woolGateJob?: number;
}

/** The societies fixture's civilization (the farm's tribe) - the one whose tech graph gates goods. */
const VIKING_TRIBE = 1;

export function livestockContent(opts: LivestockContentOptions = {}): ContentSet {
  const tribes =
    opts.woolGateJob === undefined
      ? societyContent.tribes
      : societyContent.tribes.map((t) =>
          t.typeId === VIKING_TRIBE
            ? {
                ...t,
                jobEnables: [
                  ...(t.jobEnables ?? []),
                  { jobType: opts.woolGateJob, kind: 'good', targetId: WOOL } as const,
                ],
              }
            : t,
        );
  return parseContentSet({
    manifest: TEST_MANIFEST,
    ...societyContent,
    tribes,
    ...combatContent,
    ...economyContent,
    goods: [
      ...economyContent.goods,
      { typeId: WATER, id: 'test_water' },
      { typeId: COW_GOOD, id: 'test_cow' },
      { typeId: WOOL, id: 'test_wool' },
    ],
    jobs: [
      ...economyContent.jobs,
      { typeId: BREEDER, id: 'breeder' },
      // The gating trade must exist for cross-reference validation; nobody holds it unless a test
      // spawns a settler with it.
      ...(opts.woolGateJob === undefined ? [] : [{ typeId: opts.woolGateJob, id: 'test_wool_gate' }]),
    ],
    buildings: [
      ...economyContent.buildings,
      {
        typeId: FARM,
        id: 'animal_farm',
        kind: 'workplace',
        workers: [{ jobType: BREEDER, count: 2 }],
        stock: [
          { goodType: WATER, capacity: 10, initial: 0 },
          { goodType: WHEAT, capacity: 10, initial: 0 },
          { goodType: COW_GOOD, capacity: 20, initial: 0 },
          { goodType: WOOL, capacity: 30, initial: 0 },
          { goodType: MEAT, capacity: MEAT_CAPACITY, initial: 0 },
        ],
        produces: [COW_GOOD, WOOL, MEAT],
        recipes: [
          {
            inputs: [
              { goodType: WATER, amount: 1 },
              { goodType: WHEAT, amount: 2 },
            ],
            outputs: [{ goodType: COW_GOOD, amount: 1 }],
            ticks: FEED_TICKS,
          },
          {
            inputs: [{ goodType: COW_GOOD, amount: 1 }],
            outputs: [{ goodType: WOOL, amount: 1 }],
            ticks: FEED_TICKS,
          },
          // The slaughter production (input-less meat) - recipeProductTables must drop it.
          { inputs: [], outputs: [{ goodType: MEAT, amount: 1 }], ticks: FEED_TICKS },
        ],
      },
    ],
  });
}

export function livestockSim(opts: LivestockContentOptions = {}): Simulation {
  return new Simulation({ seed: 1, content: livestockContent(opts), map: grassCellMap(32, 32) });
}

/** A built farm-type building anchored on half-cell node (hx, hy), optionally owned and stocked. */
export function farmAt(
  sim: Simulation,
  hx: number,
  hy: number,
  opts: { owner?: number; stock?: Iterable<[number, number]>; buildingType?: number } = {},
): Entity {
  const e = sim.world.create();
  sim.world.add(e, Building, { buildingType: opts.buildingType ?? FARM, tribe: 1, built: ONE, level: 0 });
  sim.world.add(e, Position, positionOfNode(hx, hy));
  sim.world.add(e, Stockpile, { amounts: new Map(opts.stock ?? []) });
  if (opts.owner !== undefined) sim.world.add(e, Owner, { player: opts.owner });
  return e;
}

/** A live cow on half-cell node (hx, hy) - optionally claimed and at a given HP. */
export function cowAt(
  sim: Simulation,
  hx: number,
  hy: number,
  opts: { hp?: number; owner?: number; tribe?: number } = {},
): Entity {
  const tribe = opts.tribe ?? COW_TRIBE;
  const e = settlerAt(sim, { jobType: null, tribe, position: positionOfNode(hx, hy) });
  sim.world.add(e, Health, { hitpoints: opts.hp ?? COW_HP, max: COW_HP });
  // Mirror the spawn stamp: a catchable species carries the Livestock marker, other tribes never do.
  if (isCatchableAnimal(sim.content, tribe)) sim.world.add(e, Livestock, {});
  if (opts.owner !== undefined) sim.world.add(e, Owner, { player: opts.owner });
  return e;
}

/** A player's scout on half-cell node (hx, hy). */
export function scoutAt(sim: Simulation, hx: number, hy: number, player: number): Entity {
  const e = settlerAt(sim, { jobType: SCOUT, position: positionOfNode(hx, hy) });
  sim.world.add(e, Owner, { player });
  return e;
}

/** A breeder standing on the farm's interaction node (its anchor - the fixture farm has no door). */
export function breederAt(sim: Simulation, hx: number, hy: number): Entity {
  return settlerAt(sim, { jobType: BREEDER, position: positionOfNode(hx, hy) });
}
