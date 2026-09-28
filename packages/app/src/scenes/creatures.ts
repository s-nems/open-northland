import { cellAnchorNode, components, type Simulation } from '@open-northland/sim';
import {
  ANIMAL_TRIBE_BEARS,
  ANIMAL_TRIBE_LIONESSES,
  ANIMAL_TRIBE_LIONS,
  ANIMAL_TRIBE_POLAR_BEARS,
  ANIMAL_TRIBE_WOLVES,
} from '../catalog/animal-tribes.js';
import { grassTerrain } from '../catalog/buildings.js';
import { MONSTER_TRIBE_WERESNAKE, MONSTER_TRIBE_WEREWOLF } from '../catalog/creatures.js';
import { JOB_SOLDIER_SWORD, JOB_SOLDIER_UNARMED } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import { spawnSandboxSettler } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const { Health, Owner, Settler } = components;

const MONSTERS = [
  { tribe: MONSTER_TRIBE_WERESNAKE, x: 9, y: 10 },
  { tribe: MONSTER_TRIBE_WEREWOLF, x: 23, y: 10 },
] as const;

const ANIMALS = [
  { tribe: ANIMAL_TRIBE_WOLVES, x: 5, y: 19 },
  { tribe: ANIMAL_TRIBE_LIONS, x: 16, y: 19 },
  { tribe: ANIMAL_TRIBE_LIONESSES, x: 27, y: 19 },
  { tribe: ANIMAL_TRIBE_BEARS, x: 11, y: 27 },
  { tribe: ANIMAL_TRIBE_POLAR_BEARS, x: 23, y: 27 },
] as const;

function build(sim: Simulation): void {
  for (const monster of MONSTERS) {
    const node = cellAnchorNode(monster.x, monster.y);
    sim.enqueueSetup({
      kind: 'spawnSettler',
      tribe: monster.tribe,
      jobType: JOB_SOLDIER_UNARMED,
      owner: ENEMY_PLAYER,
      x: node.hx,
      y: node.hy,
    });
  }
  for (const animal of ANIMALS) {
    const node = cellAnchorNode(animal.x, animal.y);
    sim.enqueueSetup({
      kind: 'spawnAnimalHerd',
      tribe: animal.tribe,
      x: node.hx,
      y: node.hy,
      count: 2,
    });
  }
  for (const x of [8, 10, 22, 24]) spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, x, 14);
}

function playerTookDamage(sim: Simulation): boolean {
  let survivors = 0;
  for (const e of sim.world.query(Settler, Owner, Health)) {
    if (sim.world.get(e, Owner).player !== HUMAN_PLAYER) continue;
    survivors++;
    const health = sim.world.get(e, Health);
    if (health.hitpoints < health.max) return true;
  }
  return survivors < 4;
}

export const creaturesScene: SceneDefinition = {
  id: 'creatures',
  seed: 71,
  terrain: grassTerrain(34, 40),
  build,
  graphicTribes: [PRIMARY_TRIBE, MONSTER_TRIBE_WERESNAKE, MONSTER_TRIBE_WEREWOLF],
  initialZoom: 0.7,
  runTicks: 240,
  checks: [
    {
      label: 'the creatures threaten the approaching soldiers',
      predicate: playerTookDamage,
    },
    {
      label: 'the encounter leaves living creatures to inspect',
      predicate: (sim) =>
        [...sim.world.query(Settler, Health)].some((e) => {
          const tribe = sim.world.get(e, Settler).tribe;
          return (
            sim.world.get(e, Health).hitpoints > 0 &&
            (MONSTERS.some((m) => m.tribe === tribe) || ANIMALS.some((a) => a.tribe === tribe))
          );
        }),
    },
  ],
};
