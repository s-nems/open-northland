import { components, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_ARCHER, JOB_CIVILIST, JOB_SOLDIER, JOB_SOLDIER_BROADSWORD } from '../../catalog/jobs.js';
import { HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_BARRACKS,
  BUILDING_HEADQUARTERS,
  placeBuiltSandboxBuilding,
  placeSandboxBuilding,
  spawnSettlerDirect,
} from '../../game/sandbox/index.js';
import { goodBySlug } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

const { Settler } = components;

const HEADQUARTERS = { x: 6, y: 12 } as const;
const BARRACKS = { x: 14, y: 10 } as const;
const COLONIST_ROW_Y = 6;
const FIRST_COLONIST_X = 8;
const COLONISTS = 4;
/** The armory pile by the headquarters, a half-cell node as `dropGood` takes. */
const ARMORY = { hx: 6, hy: 18 } as const;

const SWORD_LONG = 'sword_long';
const BOW_SHORT = 'bow_short';
/** Each class's order: one more swordsman than the armory has swords for. */
const ORDERED_PER_CLASS = 2;
const SWORDS_IN_STORE = 1;
const BOWS_IN_STORE = 2;

/** Two drill rounds (~400 ticks each with the walks) and the armory outings, with slack. */
const RUN_TICKS = 1800;

function build(sim: Simulation): void {
  placeSandboxBuilding(sim, BUILDING_HEADQUARTERS, HEADQUARTERS.x, HEADQUARTERS.y);
  placeBuiltSandboxBuilding(sim, BUILDING_BARRACKS, BARRACKS.x, BARRACKS.y);
  for (const [slug, amount] of [
    [SWORD_LONG, SWORDS_IN_STORE],
    [BOW_SHORT, BOWS_IN_STORE],
  ] as const)
    sim.enqueueSetup({ kind: 'dropGood', good: goodBySlug(sim, slug), x: ARMORY.hx, y: ARMORY.hy, amount });
  for (let i = 0; i < COLONISTS; i++)
    spawnSettlerDirect(sim, JOB_CIVILIST, FIRST_COLONIST_X + 2 * i, COLONIST_ROW_Y);
  for (const counter of ['trainSword', 'trainBow'] as const)
    sim.enqueueSetup({
      kind: 'setAssistantCounter',
      player: HUMAN_PLAYER,
      counter,
      value: ORDERED_PER_CLASS,
      infinite: false,
    });
}

/** How many of the scene's settlers hold `jobType`. */
function countOf(sim: Simulation, jobType: number): number {
  return [...sim.world.query(Settler)].filter((e) => sim.world.get(e, Settler).jobType === jobType).length;
}

export const barracksMixedOrdersScene: SceneDefinition = {
  id: 'barracks-mixed-orders',
  seed: 12,
  terrain: grassTerrain(24, 16),
  build,
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'the only sword arms one swordsman',
      predicate: (sim) => countOf(sim, JOB_SOLDIER_BROADSWORD) === SWORDS_IN_STORE,
    },
    {
      label: 'both bows arm archers, paying the bow order off',
      predicate: (sim) =>
        countOf(sim, JOB_ARCHER) === BOWS_IN_STORE &&
        sim.assistantCounters(HUMAN_PLAYER).trainBow.value === 0,
    },
    {
      label: 'nobody is drafted for the missing sword: no soldier stands bare and one colonist stays home',
      predicate: (sim) =>
        countOf(sim, JOB_SOLDIER) === 0 &&
        countOf(sim, JOB_CIVILIST) === COLONISTS - SWORDS_IN_STORE - BOWS_IN_STORE &&
        sim.assistantCounters(HUMAN_PLAYER).trainSword.value === ORDERED_PER_CLASS - SWORDS_IN_STORE,
    },
  ],
};
