import { components, type Entity, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_CIVILIST, JOB_SOLDIER, JOB_SOLDIER_BROADSWORD } from '../catalog/jobs.js';
import { jobUnlockedFor } from '../game/profession-unlocks.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_BARRACKS,
  BUILDING_HEADQUARTERS,
  GOOD_ARMOR_CHAIN,
  GOOD_SWORD_LONG,
  GOOD_SWORD_SHORT,
  placeBuiltSandboxBuilding,
  placeSandboxBuilding,
  spawnSettlerDirect,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * Barracks training: a colonist right-clicked onto the barracks walks in, drills, and comes back out a
 * soldier (see the sim's `schoolingMet` for why that is the only route). Three settlers hold the
 * contrast: the recruit, a serving soldier sent in after him (who only drills - his trade is already
 * his), and a bystander who stays a colonist and stays refused. A fourth, free colonist proves the
 * assistant's class queue: a `trainSword` counter drafts him, drills him, and arms him with the
 * strongest sword in store plus the stocked armor (the chest window's "Trenuj Mieczników" row).
 */

const { Equipment, Settler } = components;

/** The TRAINING bucket nothing may accrue - the checks prove the drill banked no experience stat
 *  (the rule the sim's `progression/experience.ts` states on this bucket). */
const TRAINING_TRACK = systems.TRAINING_EXPERIENCE_TYPE;

const HEADQUARTERS = { x: 6, y: 12 } as const;
const BARRACKS = { x: 14, y: 10 } as const;
/** The settlers' start row, clear of both footprints under the approximate and real geometries. */
const START_ROW_Y = 6;
const RECRUIT_X = 10;
const VETERAN_X = 12;
const DRAFTEE_X = 16;
const BYSTANDER_X = 8;
/** The armory pile the assistant's arming pass fetches from. */
const ARMORY = { x: 18, y: 12 } as const;

/** The manual drill (~400) plus the draftee's own drill and his one dressing outing, with slack. */
const RUN_TICKS = 1400;

function build(sim: Simulation): void {
  placeSandboxBuilding(sim, BUILDING_HEADQUARTERS, HEADQUARTERS.x, HEADQUARTERS.y);
  const barracks = placeBuiltSandboxBuilding(sim, BUILDING_BARRACKS, BARRACKS.x, BARRACKS.y);
  const recruit = spawnSettlerDirect(sim, JOB_CIVILIST, RECRUIT_X, START_ROW_Y);
  const veteran = spawnSettlerDirect(sim, JOB_SOLDIER, VETERAN_X, START_ROW_Y);
  // The draftee spawns BEFORE the bystander: the assistant drafts the lowest-id free colonist, so
  // this order is what keeps the bystander's stays-refused contrast alive.
  spawnSettlerDirect(sim, JOB_CIVILIST, DRAFTEE_X, START_ROW_Y);
  spawnSettlerDirect(sim, JOB_CIVILIST, BYSTANDER_X, START_ROW_Y);
  sim.enqueue({ kind: 'trainSoldier', entity: recruit, house: barracks });
  sim.enqueue({ kind: 'trainSoldier', entity: veteran, house: barracks });
  // The armory: both swords in store, so the arming pass provably takes the stronger one; one chain
  // armor for the dressing leg. One `trainSword` on the queue drafts exactly one man.
  sim.enqueue({ kind: 'dropGood', good: GOOD_SWORD_SHORT, x: ARMORY.x, y: ARMORY.y, amount: 1 });
  sim.enqueue({ kind: 'dropGood', good: GOOD_SWORD_LONG, x: ARMORY.x, y: ARMORY.y, amount: 1 });
  sim.enqueue({ kind: 'dropGood', good: GOOD_ARMOR_CHAIN, x: ARMORY.x, y: ARMORY.y, amount: 1 });
  sim.enqueue({
    kind: 'setAssistantCounter',
    player: HUMAN_PLAYER,
    counter: 'trainSword',
    value: 1,
    infinite: false,
  });
}

/** The four settlers by role. Query order is spawn order, which {@link build} fixes just above - the one
 *  place the mapping lives, so a reordered build changes it here rather than silently in each check. */
function cast(sim: Simulation): {
  recruit: Entity | undefined;
  veteran: Entity | undefined;
  draftee: Entity | undefined;
  bystander: Entity | undefined;
} {
  const [recruit, veteran, draftee, bystander] = sim.world.query(Settler);
  return { recruit, veteran, draftee, bystander };
}

/** Whether the settler would now be accepted for the soldier trade - the picker's filter, which mirrors
 *  the `setJob` gate, so a passing check means the row really is offered. */
function soldierOffered(sim: Simulation, e: Entity): boolean {
  const settler = sim.world.get(e, Settler);
  return jobUnlockedFor(sim.content, true, settler.tribe, settler.experience, JOB_SOLDIER);
}

export const barracksScene: SceneDefinition = {
  id: 'barracks',
  seed: 11,
  terrain: grassTerrain(24, 16),
  build,
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'the recruit walks out of the barracks a soldier',
      predicate: (sim) => {
        const { recruit } = cast(sim);
        return recruit !== undefined && sim.world.get(recruit, Settler).jobType === JOB_SOLDIER;
      },
    },
    {
      label: 'his drill banked no experience stat - the trade flip is its whole product',
      predicate: (sim) => {
        const { recruit } = cast(sim);
        return (
          recruit !== undefined && (sim.world.get(recruit, Settler).experience.get(TRAINING_TRACK) ?? 0) === 0
        );
      },
    },
    {
      label: 'the serving soldier sent in after him drills as a no-op, keeping the trade he had',
      predicate: (sim) => {
        const { veteran } = cast(sim);
        if (veteran === undefined) return false;
        const settler = sim.world.get(veteran, Settler);
        return settler.jobType === JOB_SOLDIER && (settler.experience.get(TRAINING_TRACK) ?? 0) === 0;
      },
    },
    {
      label: 'the colonist who never drilled is still refused the soldier trade',
      predicate: (sim) => {
        const { bystander } = cast(sim);
        return (
          bystander !== undefined &&
          sim.world.get(bystander, Settler).jobType === JOB_CIVILIST &&
          !soldierOffered(sim, bystander)
        );
      },
    },
    {
      label: 'the trainSword queue drafts the free colonist into a long-swordsman with the stronger blade',
      predicate: (sim) => {
        const { draftee } = cast(sim);
        if (draftee === undefined) return false;
        return (
          sim.world.get(draftee, Settler).jobType === JOB_SOLDIER_BROADSWORD &&
          sim.world.tryGet(draftee, Equipment)?.weapon?.goodType === GOOD_SWORD_LONG
        );
      },
    },
    {
      label: 'and dresses him in the stocked chain armor, paying the counter off',
      predicate: (sim) => {
        const { draftee } = cast(sim);
        if (draftee === undefined) return false;
        return (
          sim.world.tryGet(draftee, Equipment)?.armor?.goodType === GOOD_ARMOR_CHAIN &&
          sim.assistantCounters(HUMAN_PLAYER).trainSword.value === 0
        );
      },
    },
  ],
};
