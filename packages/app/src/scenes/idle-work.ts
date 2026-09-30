import { components, type Entity, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_COLLECTOR } from '../catalog/jobs.js';
import {
  BUILDING_BAKERY,
  placeBuiltSandboxBuilding,
  spawnSettlerDirect,
  spawnWorkersAtDoor,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

export const IDLE_WORK_NAMES = {
  ingredients: 'Ingrid',
  selection: 'Sigrid',
  storage: 'Freya',
  resources: 'Bjorn',
} as const;

export function idleWorkWorker(sim: Simulation, name: string): Entity | undefined {
  for (const entity of sim.world.query(components.GivenName)) {
    if (sim.world.get(entity, components.GivenName).name === name) return entity;
  }
  return undefined;
}

function bakery(sim: Simulation, x: number, y: number, name: string): { building: Entity; worker: Entity } {
  const building = placeBuiltSandboxBuilding(sim, BUILDING_BAKERY, x, y);
  sim.world.mut(building, components.Stockpile).amounts.clear();
  spawnWorkersAtDoor(sim, building, 1);
  for (const worker of sim.world.query(components.JobAssignment)) {
    if (sim.world.get(worker, components.JobAssignment).workplace !== building) continue;
    sim.world.add(worker, components.GivenName, { name });
    return { building, worker };
  }
  throw new Error('The bakery has no assigned worker');
}

function bakeryDefinition(sim: Simulation) {
  const definition = sim.content.buildings.find((row) => row.typeId === BUILDING_BAKERY);
  if (definition === undefined) throw new Error('The scene needs a bakery');
  return definition;
}

function bakeryRecipe(sim: Simulation) {
  const recipe = bakeryDefinition(sim).recipes[0];
  if (recipe === undefined) throw new Error('The scene needs a bakery recipe');
  return recipe;
}

export const idleWorkScene: SceneDefinition = {
  id: 'idle-work',
  seed: 83,
  terrain: grassTerrain(40, 26),
  initialZoom: 0.9,
  progression: false,
  build: (sim) => {
    bakery(sim, 10, 9, IDLE_WORK_NAMES.ingredients);
    const stopped = bakery(sim, 26, 9, IDLE_WORK_NAMES.selection);
    for (const good of bakeryDefinition(sim).produces) {
      components.writeProductionCount(sim.world, stopped.worker, good, 0);
    }
    const full = bakery(sim, 10, 20, IDLE_WORK_NAMES.storage);
    const stock = sim.world.mut(full.building, components.Stockpile);
    for (const slot of bakeryDefinition(sim).stock) stock.amounts.set(slot.goodType, slot.capacity);
    const collector = spawnSettlerDirect(sim, JOB_COLLECTOR, 26, 20);
    sim.world.add(collector, components.GivenName, { name: IDLE_WORK_NAMES.resources });
  },
  runTicks: 120,
  checks: [
    {
      label: 'the collector reports no eligible resource in the work area',
      predicate: (sim) => {
        const worker = idleWorkWorker(sim, IDLE_WORK_NAMES.resources);
        if (worker === undefined) return false;
        const status = sim.workStatus(worker);
        return status?.kind === 'noEligibleResource' && status.goodTypes.length > 0;
      },
    },
    {
      label: 'the empty bakery reports both missing ingredients',
      predicate: (sim) => {
        const worker = idleWorkWorker(sim, IDLE_WORK_NAMES.ingredients);
        if (worker === undefined) return false;
        const status = sim.workStatus(worker);
        const recipe = bakeryRecipe(sim);
        return (
          status?.kind === 'waitingInput' &&
          status.goodType === recipe.outputs[0]?.goodType &&
          status.missingInputs.length === recipe.inputs.length &&
          recipe.inputs.every((required) =>
            status.missingInputs.some(
              (input) =>
                input.goodType === required.goodType &&
                input.required === required.amount &&
                input.available === 0 &&
                input.missing === required.amount,
            ),
          )
        );
      },
    },
    {
      label: 'the stopped baker reports an empty production selection',
      predicate: (sim) => {
        const worker = idleWorkWorker(sim, IDLE_WORK_NAMES.selection);
        return worker !== undefined && sim.workStatus(worker)?.kind === 'nothingSelected';
      },
    },
    {
      label: 'the stocked bakery reports the full bread shelf',
      predicate: (sim) => {
        const worker = idleWorkWorker(sim, IDLE_WORK_NAMES.storage);
        if (worker === undefined) return false;
        const status = sim.workStatus(worker);
        return (
          status?.kind === 'outputFull' &&
          status.outputs.some(
            (output) =>
              output.goodType === bakeryRecipe(sim).outputs[0]?.goodType &&
              output.available === output.capacity &&
              output.required > 0,
          )
        );
      },
    },
  ],
};
