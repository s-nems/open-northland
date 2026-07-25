import { cellAnchorNode, components, type Entity, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import {
  ANIMAL_TRIBE_BEARS,
  ANIMAL_TRIBE_STAGS,
  ANIMAL_TRIBE_WOLVES,
  buildSandboxAnimals,
} from '../game/sandbox/content/catalog/animals.js';
import type { SceneDefinition } from './types.js';

/**
 * The wildlife sign-off scene: three species herds spawned on open grass via `spawnAnimalHerd`, so a
 * human can judge the animal render binding (species bodies, facings, shadows, the idle loops)
 * against the original. Headless, it proves the sandbox animal catalog actually places wildlife:
 * full herd counts, jobless and unowned members, and the wolf's data-pinned pace. In the browser an
 * admin-spawned soldier beside the wolves starts a fight; an unowned animal swings in place, so the
 * bite plays its facing-remapped attack cycle at the attacker (walking waits on a wander drive).
 */

const MAP_W = 26;
const MAP_H = 20;

/** Herd birth points (cells), spread so the packs read as separate groups on screen. */
const HERDS: readonly { tribe: number; x: number; y: number }[] = [
  { tribe: ANIMAL_TRIBE_BEARS, x: 6, y: 5 },
  { tribe: ANIMAL_TRIBE_STAGS, x: 18, y: 7 },
  { tribe: ANIMAL_TRIBE_WOLVES, x: 11, y: 14 },
];

/** The spawn-count floor per herd, read off the catalog records so the check cannot drift. */
const EXPECTED_COUNTS: readonly { tribe: number; count: number }[] = buildSandboxAnimals().map((a) => ({
  tribe: a.tribeType,
  count: a.maximumGroupSize,
}));

const { MoveSpeed, Owner, Settler } = components;

function build(sim: Simulation): void {
  for (const herd of HERDS) {
    const node = cellAnchorNode(herd.x, herd.y);
    sim.enqueue({ kind: 'spawnAnimalHerd', tribe: herd.tribe, x: node.hx, y: node.hy });
  }
}

function membersOf(sim: Simulation, tribe: number): Entity[] {
  const members: Entity[] = [];
  for (const e of sim.world.query(Settler)) {
    if (sim.world.get(e, Settler).tribe === tribe) members.push(e);
  }
  return members;
}

export const wildlifeScene: SceneDefinition = {
  id: 'wildlife',
  seed: 31,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: 300,
  initialZoom: 0.8,
  checks: [
    {
      label: 'every herd spawned at full group size',
      predicate: (sim) => EXPECTED_COUNTS.every(({ tribe, count }) => membersOf(sim, tribe).length >= count),
    },
    {
      label: 'wildlife is jobless (an animal is a settler outside every trade)',
      predicate: (sim) =>
        HERDS.every((h) => membersOf(sim, h.tribe).every((e) => sim.world.get(e, Settler).jobType === null)),
    },
    {
      label: 'wildlife is unowned (no player claims an animal)',
      predicate: (sim) => {
        for (const e of sim.world.query(Settler, Owner)) {
          const tribe = sim.world.get(e, Settler).tribe;
          if (HERDS.some((h) => h.tribe === tribe)) return false;
        }
        return true;
      },
    },
    {
      label: 'the wolves walk at their data-pinned movespeed pace',
      predicate: (sim) => {
        const wolves = membersOf(sim, ANIMAL_TRIBE_WOLVES);
        const paced = new Set(sim.world.query(Settler, MoveSpeed));
        return wolves.length > 0 && wolves.every((e) => paced.has(e));
      },
    },
  ],
};
