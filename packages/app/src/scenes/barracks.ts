import { components, type Entity, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_CIVILIST, JOB_SOLDIER, JOB_SOLDIER_BROADSWORD } from '../catalog/jobs.js';
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

const { Equipment, Settler, SettlerProgress } = components;

/** The drill banks nothing in this bucket, the rule `progression/experience.ts` states on it. */
const TRAINING_TRACK = systems.TRAINING_EXPERIENCE_TYPE;

const HEADQUARTERS = { x: 6, y: 12 } as const;
const BARRACKS = { x: 14, y: 10 } as const;
/** Clear of both building footprints under the approximate and the real geometries. */
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
  // Spawn order matters: the assistant drafts the lowest-id free colonist, so the bystander comes after.
  spawnSettlerDirect(sim, JOB_CIVILIST, DRAFTEE_X, START_ROW_Y);
  spawnSettlerDirect(sim, JOB_CIVILIST, BYSTANDER_X, START_ROW_Y);
  sim.enqueueSetup({ kind: 'trainSoldier', entity: recruit, house: barracks });
  sim.enqueueSetup({ kind: 'trainSoldier', entity: veteran, house: barracks });
  // Both swords in store, so the arming pass has to pick the stronger one.
  sim.enqueueSetup({ kind: 'dropGood', good: GOOD_SWORD_SHORT, x: ARMORY.x, y: ARMORY.y, amount: 1 });
  sim.enqueueSetup({ kind: 'dropGood', good: GOOD_SWORD_LONG, x: ARMORY.x, y: ARMORY.y, amount: 1 });
  sim.enqueueSetup({ kind: 'dropGood', good: GOOD_ARMOR_CHAIN, x: ARMORY.x, y: ARMORY.y, amount: 1 });
  sim.enqueueSetup({
    kind: 'setAssistantCounter',
    player: HUMAN_PLAYER,
    counter: 'trainSword',
    value: 1,
    infinite: false,
  });
}

/** Query order is spawn order, so the roles follow the sequence `build` spawns them in. */
function cast(sim: Simulation): {
  recruit: Entity | undefined;
  veteran: Entity | undefined;
  draftee: Entity | undefined;
  bystander: Entity | undefined;
} {
  const [recruit, veteran, draftee, bystander] = sim.world.query(Settler);
  return { recruit, veteran, draftee, bystander };
}

/** The gate the job picker and the `setJob` command share. */
function soldierOffered(sim: Simulation, e: Entity): boolean {
  return sim.canChooseJob(e, JOB_SOLDIER);
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
          recruit !== undefined &&
          (sim.world.get(recruit, SettlerProgress).experience.get(TRAINING_TRACK) ?? 0) === 0
        );
      },
    },
    {
      label: 'the serving soldier sent in after him drills as a no-op, keeping the trade he had',
      predicate: (sim) => {
        const { veteran } = cast(sim);
        if (veteran === undefined) return false;
        const drilled = sim.world.get(veteran, SettlerProgress).experience.get(TRAINING_TRACK) ?? 0;
        return sim.world.get(veteran, Settler).jobType === JOB_SOLDIER && drilled === 0;
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
