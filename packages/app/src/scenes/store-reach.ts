import { components, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { BUILDING_HEADQUARTERS, placeBuiltSandboxBuilding } from '../game/sandbox/index.js';
import { IDLE_WORK_NAMES, idleWorkBakery, idleWorkBakeryDefinition, idleWorkWorker } from './idle-work.js';
import type { SceneDefinition } from './types.js';

const STORE_REACH_NAMES = {
  output: IDLE_WORK_NAMES.storage,
  input: IDLE_WORK_NAMES.ingredients,
} as const;

const BAKERY_X = 8;
const FULL_BAKERY_ROW = 6;
const EMPTY_BAKERY_ROW = 14;
/** Far beyond the bakeries' 25-tile walk range, with no signpost to extend it. */
const HEADQUARTERS = { x: 70, y: 10 } as const;
/** Units of each bread ingredient the distant headquarters holds. */
const STOCKED_INPUT = 5;

function workerStatus(sim: Simulation, name: string) {
  const worker = idleWorkWorker(sim, name);
  return worker === undefined ? undefined : sim.workStatus(worker);
}

export const storeReachScene: SceneDefinition = {
  id: 'store-reach',
  seed: 84,
  terrain: grassTerrain(80, 20),
  initialZoom: 0.9,
  progression: false,
  build: (sim) => {
    const bakery = idleWorkBakeryDefinition(sim);
    const full = idleWorkBakery(sim, BAKERY_X, FULL_BAKERY_ROW, STORE_REACH_NAMES.output);
    const shelf = sim.world.mut(full.building, components.Stockpile);
    for (const slot of bakery.stock) shelf.amounts.set(slot.goodType, slot.capacity);
    idleWorkBakery(sim, BAKERY_X, EMPTY_BAKERY_ROW, STORE_REACH_NAMES.input);
    const headquarters = placeBuiltSandboxBuilding(
      sim,
      BUILDING_HEADQUARTERS,
      HEADQUARTERS.x,
      HEADQUARTERS.y,
    );
    const stock = sim.world.mut(headquarters, components.Stockpile);
    stock.amounts.clear();
    for (const input of bakery.recipes[0]?.inputs ?? []) stock.amounts.set(input.goodType, STOCKED_INPUT);
  },
  runTicks: 120,
  checks: [
    {
      label: 'the full bakery names the bread no store within signpost reach takes',
      predicate: (sim) => {
        const status = workerStatus(sim, STORE_REACH_NAMES.output);
        return status?.kind === 'noOutputDestination' && status.reason === 'outOfReach';
      },
    },
    {
      label: 'the empty bakery marks its ingredients as stocked only outside signpost reach',
      predicate: (sim) => {
        const status = workerStatus(sim, STORE_REACH_NAMES.input);
        return (
          status?.kind === 'waitingInput' &&
          status.missingInputs.length > 0 &&
          status.missingInputs.every((input) => input.outOfReach)
        );
      },
    },
  ],
};
