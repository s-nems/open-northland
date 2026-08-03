import {
  cellAnchorNode,
  components,
  type Entity,
  fx,
  nodeOfPosition,
  type Simulation,
} from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import {
  ANIMAL_TRIBE_BEARS,
  ANIMAL_TRIBE_STAGS,
  ANIMAL_TRIBE_WOLVES,
  buildSandboxAnimals,
} from '../game/sandbox/content/catalog/animals.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 26;
const MAP_H = 20;

/** Birth points in cells, spread so the packs read as separate groups on screen. */
const HERDS: readonly { tribe: number; x: number; y: number }[] = [
  { tribe: ANIMAL_TRIBE_BEARS, x: 6, y: 5 },
  { tribe: ANIMAL_TRIBE_STAGS, x: 18, y: 7 },
  { tribe: ANIMAL_TRIBE_WOLVES, x: 11, y: 14 },
];

/** Read off the catalog records, which carry more species than this scene places, so the check cannot
 *  drift. */
const EXPECTED_COUNTS: readonly { tribe: number; count: number }[] = buildSandboxAnimals()
  .filter((a) => HERDS.some((h) => h.tribe === a.tribeType))
  .map((a) => ({ tribe: a.tribeType, count: a.maximumGroupSize }));

const { MoveSpeed, Owner, Position, Settler, StayPoint } = components;

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

/** A margin under what this scene reaches, so a shift in the rng stream cannot flip the check. */
const MIN_GRAZED_PERCENT = 50;

const NEED_EMPTY = fx.fromInt(0);

function allAnimals(sim: Simulation): Entity[] {
  return [...sim.world.query(StayPoint, Position)];
}

function countOffBirthNode(sim: Simulation, animals: readonly Entity[]): number {
  const terrain = sim.terrain;
  if (terrain === undefined) return 0;
  return animals.filter((e) => {
    const p = sim.world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    return terrain.nodeAtClamped(n.hx, n.hy) !== sim.world.get(e, StayPoint).cell;
  }).length;
}

export const wildlifeScene: SceneDefinition = {
  id: 'wildlife',
  seed: 31,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  // Needs ON against the scene default: with the rule disabled, no bar could rise whatever needsSystem did.
  needs: true,
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
    {
      // Grazing steps are undirected, so a creature can stand back on its anchor when the run ends;
      // hence a share rather than every animal.
      label: 'the herds grazed off their birth points (nothing stands frozen)',
      predicate: (sim) => {
        const animals = allAnimals(sim);
        return (
          animals.length > 0 && 100 * countOffBirthNode(sim, animals) >= MIN_GRAZED_PERCENT * animals.length
        );
      },
    },
    {
      label: 'wildlife runs no need bars (no permanent hunger bubble over the herds)',
      predicate: (sim) => {
        const animals = allAnimals(sim);
        return (
          animals.length > 0 &&
          animals.every((e) => {
            const needs = sim.world.get(e, Settler);
            return (
              needs.hunger === NEED_EMPTY && needs.fatigue === NEED_EMPTY && needs.enjoyment === NEED_EMPTY
            );
          })
        );
      },
    },
  ],
};
