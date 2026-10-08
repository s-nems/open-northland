import {
  components,
  type Entity,
  fx,
  hexDistanceBetween,
  nodeOfPosition,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_CIVILIST, JOB_SOLDIER, JOB_SOLDIER_BROADSWORD } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_BARRACKS,
  BUILDING_HEADQUARTERS,
  placeBuiltSandboxBuilding,
  placeSandboxBuilding,
  spawnSettlerDirect,
} from '../game/sandbox/index.js';
import { goodBySlug } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

const { EquipOrder, Equipment, Position, Settler, SettlerProgress } = components;

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
/** The armory pile the arming pass fetches from, by the headquarters and away from the barracks, so the
 *  walk back shows; a half-cell node, as `dropGood` takes. */
const ARMORY = { hx: 6, hy: 18 } as const;

const SWORD_SHORT = 'sword_shord'; // the content's own spelling
const SWORD_LONG = 'sword_long';
const ARMOR_CHAIN = 'armor_chain';

/** The manual drill (~400) plus the draftee's own drill and his one dressing outing there and back,
 *  with slack. */
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
  for (const slug of [SWORD_SHORT, SWORD_LONG, ARMOR_CHAIN])
    sim.enqueueSetup({
      kind: 'dropGood',
      good: goodBySlug(sim, slug),
      x: ARMORY.hx,
      y: ARMORY.hy,
      amount: 1,
    });
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

/** The hex distance, in half-cell nodes, from an entity's position to node `to`. */
function nodesBetween(sim: Simulation, e: Entity, to: { readonly hx: number; readonly hy: number }): number {
  const p = sim.world.get(e, Position);
  const at = nodeOfPosition(p.x, p.y);
  return hexDistanceBetween(at.hx, at.hy, to.hx, to.hy);
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
          sim.world.tryGet(draftee, Equipment)?.weapon?.goodType === goodBySlug(sim, SWORD_LONG)
        );
      },
    },
    {
      label: 'and dresses him in the stocked chain armor, paying the counter off',
      predicate: (sim) => {
        const { draftee } = cast(sim);
        if (draftee === undefined) return false;
        return (
          sim.world.tryGet(draftee, Equipment)?.armor?.goodType === goodBySlug(sim, ARMOR_CHAIN) &&
          sim.assistantCounters(HUMAN_PLAYER).trainSword.value === 0
        );
      },
    },
    {
      label: 'then walks back from the armory to the barracks',
      predicate: (sim) => {
        const { draftee } = cast(sim);
        if (draftee === undefined || sim.world.has(draftee, EquipOrder)) return false;
        const barracks = nodeOfPosition(fx.fromInt(BARRACKS.x), fx.fromInt(BARRACKS.y));
        return nodesBetween(sim, draftee, barracks) < nodesBetween(sim, draftee, ARMORY);
      },
    },
  ],
};
