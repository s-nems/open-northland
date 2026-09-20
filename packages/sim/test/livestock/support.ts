import { type ContentSet, parseContentSet } from '@open-northland/data';
import {
  Building,
  FarmAnimal,
  Health,
  JobAssignment,
  Livestock,
  Owner,
  Position,
  Stockpile,
  YoungAnimal,
} from '../../src/components/index.js';
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

// The husbandry fixture: the shared synthetic content plus the livestock slice - a species good
// slug-joined to the societies fixture's catchable `test_cow` tribe, and an animal farm whose one
// recipe breeds it. Its wool and meat have no recipe at all: they arrive through the breeder's
// slaughter clip, whose `PUT_GOOD_IN_STOCK` frames the fixture authors below.

/** The societies fixture's catchable cow (tribe 13, `test_cow`, 1000 HP adult). */
export const COW_TRIBE = 13;
export const COW_HP = 1000;
export const CALF_HP = 500;
/** An animal tribe that is NOT catchable (the aggressive bear) - the capture counter-case. */
export const BEAR_TRIBE = 10;
/** The species good - its id `test_cow` is the slug join to {@link COW_TRIBE}, and the farm's row of it
 *  counts the herd. */
export const COW_GOOD = 57;
export const WOOL = 58;
/** The economy fixture's meat. */
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
/** The breeder's general experience track: the job efficiency the original scales a clip's deposit by. */
export const BREEDER_TRACK = 64;
export const BREEDER_XP_PER_REPEAT = 100;
export const BREED_TICKS = 10;
export const HERD_CAPACITY = 20;
export const WOOL_CAPACITY = 3;
export const MEAT_CAPACITY = 3;

/** The breeder's two species actions (`jobtypes.ini` breeder `allowatomic`), and the clips they play.
 *  The slay clip's name carries the species slug, which is the only link content gives the two. */
export const BREED_ATOMIC = 85;
export const SLAY_ATOMIC = 87;
export const BREED_CLIP = 'test_breeder_produce_test_cow';
export const SLAY_CLIP = 'test_breeder_slay_test_cow';
export const SLAY_CLIP_TICKS = 10;
/** The frames the slay clip banks its wares on: one fleece, then two cuts of meat. */
export const SLAY_DEPOSITS: readonly (readonly [number, number])[] = [
  [3, WOOL],
  [5, MEAT],
  [7, MEAT],
];
const PUT_GOOD_IN_STOCK = 27;

/** The societies fixture's civilization (the farm's tribe). */
const VIKING_TRIBE = 1;

export function livestockContent(): ContentSet {
  return parseContentSet({
    manifest: TEST_MANIFEST,
    ...societyContent,
    tribes: societyContent.tribes.map((t) =>
      t.typeId === VIKING_TRIBE
        ? {
            ...t,
            atomicBindings: [
              ...(t.atomicBindings ?? []),
              { jobType: BREEDER, atomicId: BREED_ATOMIC, animation: BREED_CLIP },
              { jobType: BREEDER, atomicId: SLAY_ATOMIC, animation: SLAY_CLIP },
            ],
          }
        : t,
    ),
    ...combatContent,
    ...economyContent,
    atomicAnimations: [
      ...societyContent.atomicAnimations,
      { id: BREED_CLIP, name: BREED_CLIP, length: SLAY_CLIP_TICKS, events: [] },
      {
        id: SLAY_CLIP,
        name: SLAY_CLIP,
        length: SLAY_CLIP_TICKS,
        events: SLAY_DEPOSITS.map(([at, good]) => ({ at, type: PUT_GOOD_IN_STOCK, value: good })),
      },
    ],
    goods: [
      ...economyContent.goods,
      { typeId: WATER, id: 'test_water' },
      { typeId: COW_GOOD, id: 'test_cow', atomics: { produce: BREED_ATOMIC } },
      { typeId: WOOL, id: 'test_wool' },
    ],
    jobs: [
      ...economyContent.jobs,
      { typeId: BREEDER, id: 'breeder', allowedAtomics: [BREED_ATOMIC, SLAY_ATOMIC] },
    ],
    jobExperience: [
      ...societyContent.jobExperience,
      {
        typeId: BREEDER_TRACK,
        id: 'breeder_general',
        name: 'breeder general',
        jobType: BREEDER,
        experienceFactor: BREEDER_XP_PER_REPEAT,
      },
    ],
    buildings: [
      // The headquarters doubles as the warehouse a farm's wares are carried out to, so the flush has
      // somewhere to go.
      ...economyContent.buildings.map((b) =>
        b.typeId === HEADQUARTERS
          ? {
              ...b,
              stock: [
                ...(b.stock ?? []),
                { goodType: WOOL, capacity: 20, initial: 0 },
                { goodType: MEAT, capacity: 20, initial: 0 },
              ],
            }
          : b,
      ),
      {
        typeId: FARM,
        id: 'animal_farm',
        kind: 'workplace',
        workers: [{ jobType: BREEDER, count: 2 }],
        stock: [
          { goodType: WATER, capacity: 10, initial: 0 },
          { goodType: WHEAT, capacity: 10, initial: 0 },
          { goodType: COW_GOOD, capacity: HERD_CAPACITY, initial: 0 },
          { goodType: WOOL, capacity: WOOL_CAPACITY, initial: 0 },
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
            ticks: BREED_TICKS,
          },
        ],
      },
    ],
  });
}

export function livestockSim(): Simulation {
  return new Simulation({ seed: 1, content: livestockContent(), map: grassCellMap(32, 32) });
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

/** A live cow on half-cell node (hx, hy) - optionally claimed, attached to a farm, or still a calf. */
export function cowAt(
  sim: Simulation,
  hx: number,
  hy: number,
  opts: { hp?: number; owner?: number; tribe?: number; farm?: Entity; young?: boolean } = {},
): Entity {
  const tribe = opts.tribe ?? COW_TRIBE;
  const e = settlerAt(sim, { jobType: null, tribe, position: positionOfNode(hx, hy) });
  sim.world.add(e, Health, { hitpoints: opts.hp ?? COW_HP, max: COW_HP });
  // Mirror the spawn stamp: a catchable species carries the Livestock marker, other tribes never do.
  if (isCatchableAnimal(sim.content, tribe)) sim.world.add(e, Livestock, {});
  if (opts.owner !== undefined) sim.world.add(e, Owner, { player: opts.owner });
  if (opts.farm !== undefined) sim.world.add(e, FarmAnimal, { farm: opts.farm, summoner: null });
  if (opts.young === true) sim.world.add(e, YoungAnimal, { adultAt: Number.POSITIVE_INFINITY });
  return e;
}

/** A player's scout on half-cell node (hx, hy). */
export function scoutAt(sim: Simulation, hx: number, hy: number, player: number): Entity {
  const e = settlerAt(sim, { jobType: SCOUT, position: positionOfNode(hx, hy) });
  sim.world.add(e, Owner, { player });
  return e;
}

/** A breeder on half-cell node (hx, hy), employed at `farm`. */
export function breederAt(sim: Simulation, hx: number, hy: number, farm?: Entity): Entity {
  const e = settlerAt(sim, { jobType: BREEDER, position: positionOfNode(hx, hy) });
  if (farm !== undefined) {
    sim.world.add(e, JobAssignment, { workplace: farm });
    const owner = sim.world.tryGet(farm, Owner);
    if (owner !== undefined) sim.world.add(e, Owner, { player: owner.player });
  }
  return e;
}
