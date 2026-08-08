import { cellAnchorNode, components, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import { spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * First-contact discovery and the diplomacy stance table under RECON fog: the ally beside you is
 * discovered at once and mutual friendship never becomes a fight, a one-way aggressor marching out of
 * the fog is discovered by its own blow and flips your stance to enemy, and a player no eye ever
 * reached stays undiscovered. The browser view pairs this with the diplomacy window on the tool panel.
 */

const MAP_W = 40;
const MAP_H = 12;

const ALLY_PLAYER = 1;
/** The one-way aggressor: hostile toward the human seat, which starts friendly toward it. */
const RIVAL_PLAYER = 2;
/** Spawned beyond every eye and staying there, so discovery has a negative to prove. */
const STRANGER_PLAYER = 3;

const HUMAN_AT = { x: 6, y: 6 } as const;
const ALLY_AT = { x: 8, y: 6 } as const;
/** 10 cells east of the human soldier - beyond both soldiers' 544 px eyes until the march closes in. */
const RIVAL_AT = { x: 16, y: 6 } as const;
const STRANGER_AT = { x: 36, y: 10 } as const;

const { Health, Owner, Settler } = components;

function build(sim: Simulation): void {
  spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, HUMAN_AT.x, HUMAN_AT.y, HUMAN_PLAYER);
  spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, ALLY_AT.x, ALLY_AT.y, ALLY_PLAYER);
  const rival = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, RIVAL_AT.x, RIVAL_AT.y, RIVAL_PLAYER);
  spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, STRANGER_AT.x, STRANGER_AT.y, STRANGER_PLAYER);

  sim.enqueueSetup({ kind: 'setDiplomacy', from: HUMAN_PLAYER, to: ALLY_PLAYER, state: 'friend' });
  sim.enqueueSetup({ kind: 'setDiplomacy', from: ALLY_PLAYER, to: HUMAN_PLAYER, state: 'friend' });
  // The one-way shape real maps author: the seat starts friendly toward a player hostile back.
  sim.enqueueSetup({ kind: 'setDiplomacy', from: HUMAN_PLAYER, to: RIVAL_PLAYER, state: 'friend' });
  sim.enqueueSetup({ kind: 'setDiplomacy', from: RIVAL_PLAYER, to: HUMAN_PLAYER, state: 'enemy' });
  // The ally and the rival stay out of each other's war, so the ally's health is a clean check.
  sim.enqueueSetup({ kind: 'setDiplomacy', from: ALLY_PLAYER, to: RIVAL_PLAYER, state: 'neutral' });
  sim.enqueueSetup({ kind: 'setDiplomacy', from: RIVAL_PLAYER, to: ALLY_PLAYER, state: 'neutral' });

  const target = cellAnchorNode(HUMAN_AT.x, HUMAN_AT.y);
  sim.enqueueSetup({ kind: 'attackMoveUnit', entity: rival, x: target.hx, y: target.hy });
}

/** Every living settler of `owner` still has full health. */
function unharmed(sim: Simulation, owner: number): boolean {
  for (const e of sim.world.query(Settler, Owner, Health)) {
    if (sim.world.get(e, Owner).player !== owner) continue;
    const health = sim.world.get(e, Health);
    if (health.hitpoints < health.max) return false;
  }
  return true;
}

export const diplomacyScene: SceneDefinition = {
  id: 'diplomacy',
  seed: 31,
  terrain: grassTerrain(MAP_W, MAP_H),
  fog: 'recon',
  build,
  runTicks: 900,
  initialZoom: 0.8,
  checks: [
    {
      label: 'the ally beside you is discovered and mutual friendship never became a fight',
      predicate: (sim) =>
        sim.hasMetPlayer(HUMAN_PLAYER, ALLY_PLAYER) &&
        sim.diplomacyStance(HUMAN_PLAYER, ALLY_PLAYER) === 'friend' &&
        sim.diplomacyStance(ALLY_PLAYER, HUMAN_PLAYER) === 'friend' &&
        unharmed(sim, ALLY_PLAYER),
    },
    {
      label: 'the one-way aggressor is discovered and its blow flipped your stance to enemy',
      predicate: (sim) =>
        sim.hasMetPlayer(HUMAN_PLAYER, RIVAL_PLAYER) &&
        sim.diplomacyStance(HUMAN_PLAYER, RIVAL_PLAYER) === 'enemy',
    },
    {
      label: 'a player no eye ever reached stays undiscovered',
      predicate: (sim) => !sim.hasMetPlayer(HUMAN_PLAYER, STRANGER_PLAYER),
    },
  ],
};
