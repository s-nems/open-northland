import { cellAnchorNode, components, type Entity, playerCommand, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_SCOUT } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import { ANIMAL_TRIBE_CATTLE, ANIMAL_TRIBE_SHEEP } from '../game/sandbox/content/catalog/animals.js';
import { spawnSettlerDirect } from '../game/sandbox/index.js';
import { createSceneSim } from './runtime.js';
import type { SceneDefinition } from './types.js';

/**
 * A scout sent after an animal: one scout on the west edge, a wild sheep herd and a wild cattle herd far
 * off to the east, grazing as they go. Select the scout, right click a sheep and it follows that sheep
 * until it is yours; Shift + right click a cow first and it goes after the cow once the sheep is claimed.
 */

const MAP_W = 40;
const MAP_H = 24;
const INITIAL_ZOOM = 0.8;
const SCOUT = { x: 4, y: 12 } as const;
const SHEEP_BIRTH = { x: 32, y: 5 } as const;
const CATTLE_BIRTH = { x: 32, y: 19 } as const;
/** Ticks the herds take to appear: their spawn commands apply on the first tick. */
const SPAWN_TICKS = 1;
/** Both walks across the map with the animals moving off, with margin. */
const CHASE_TICKS = 3000;

const { Owner, Settler } = components;

function build(sim: Simulation): void {
  for (const herd of [
    { tribe: ANIMAL_TRIBE_SHEEP, at: SHEEP_BIRTH },
    { tribe: ANIMAL_TRIBE_CATTLE, at: CATTLE_BIRTH },
  ]) {
    const node = cellAnchorNode(herd.at.x, herd.at.y);
    sim.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: herd.tribe, x: node.hx, y: node.hy });
  }
  spawnSettlerDirect(sim, JOB_SCOUT, SCOUT.x, SCOUT.y);
}

function firstOf(sim: Simulation, tribe: number): Entity | undefined {
  return sim.world.canonicalQuery(Settler).find((e) => sim.world.get(e, Settler).tribe === tribe);
}

function scoutOf(sim: Simulation): Entity | undefined {
  return sim.world.canonicalQuery(Settler).find((e) => sim.world.get(e, Settler).jobType === JOB_SCOUT);
}

const ownedByHuman = (sim: Simulation, e: Entity): boolean =>
  sim.world.tryGet(e, Owner)?.player === HUMAN_PLAYER;

/** The order in which the ordered sheep and the Shift-queued cow became the player's, re-simulating the
 *  scene with the clicks a player would make once the herds stand. */
function claimOrder(): readonly string[] {
  const sim = createSceneSim(scoutClaimScene);
  for (let i = 0; i < SPAWN_TICKS; i++) sim.step();
  const scout = scoutOf(sim);
  const sheep = firstOf(sim, ANIMAL_TRIBE_SHEEP);
  const cow = firstOf(sim, ANIMAL_TRIBE_CATTLE);
  if (scout === undefined || sheep === undefined || cow === undefined) return [];
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'claimAnimal', entity: scout, animal: sheep }));
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'claimAnimal', entity: scout, animal: cow, queued: true }));
  const claimed: string[] = [];
  for (let i = 0; i < CHASE_TICKS && claimed.length < 2; i++) {
    sim.step();
    if (!claimed.includes('sheep') && ownedByHuman(sim, sheep)) claimed.push('sheep');
    if (!claimed.includes('cow') && ownedByHuman(sim, cow)) claimed.push('cow');
  }
  return claimed;
}

export const scoutClaimScene: SceneDefinition = {
  id: 'scout-claim',
  seed: 23,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: SPAWN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'the scout claimed the sheep it was sent after, then the Shift-queued cow',
      predicate: () => claimOrder().join(',') === 'sheep,cow',
    },
  ],
};
