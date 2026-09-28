import { cellAnchorNode, components, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { MONSTER_TRIBE_WERESNAKE } from '../catalog/creatures.js';
import {
  JOB_BREEDER,
  JOB_FARMER,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SPEAR_WOODEN,
  JOB_SOLDIER_SWORD,
} from '../catalog/jobs.js';
import { ENEMY_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import { spawnSandboxSettler } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const FORM_JOBS = [
  JOB_BREEDER,
  JOB_FARMER,
  JOB_SOLDIER_SPEAR_WOODEN,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_BROADSWORD,
] as const;

const FORM_X = [10, 15, 20, 25, 30] as const;

function build(sim: Simulation): void {
  for (const [index, jobType] of FORM_JOBS.entries()) {
    const node = cellAnchorNode(FORM_X[index] ?? 0, 12);
    sim.enqueueSetup({
      kind: 'spawnSettler',
      tribe: MONSTER_TRIBE_WERESNAKE,
      jobType,
      owner: ENEMY_PLAYER,
      x: node.hx,
      y: node.hy,
    });
  }
  // The three soldier forms have targets nearby; the two peaceful job forms remain unobstructed.
  for (const x of [20, 25, 30]) spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, x, 17);
}

export const creatureFormsScene: SceneDefinition = {
  id: 'creature-forms',
  seed: 72,
  terrain: grassTerrain(42, 30),
  build,
  graphicTribes: [PRIMARY_TRIBE, MONSTER_TRIBE_WERESNAKE],
  initialZoom: 0.85,
  runTicks: 240,
  checks: [
    {
      label: 'the harmless sheep and chicken forms remain alive for inspection',
      predicate: (sim) => {
        const actual = new Set<number>();
        for (const entity of sim.world.query(components.Settler)) {
          const settler = sim.world.get(entity, components.Settler);
          if (settler.tribe === MONSTER_TRIBE_WERESNAKE && settler.jobType !== null)
            actual.add(settler.jobType);
        }
        return actual.has(JOB_BREEDER) && actual.has(JOB_FARMER);
      },
    },
    {
      label: 'each soldier facing a warrior form takes damage',
      predicate: (sim) => {
        const soldiers = [...sim.world.query(components.Settler, components.Health)]
          .filter((entity) => sim.world.get(entity, components.Settler).tribe === PRIMARY_TRIBE)
          .map((entity) => sim.world.get(entity, components.Health));
        return soldiers.length === 3 && soldiers.every((health) => health.hitpoints < health.max);
      },
    },
  ],
};
