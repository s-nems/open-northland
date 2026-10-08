import { cellAnchorNode, FOG_STATE, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import { spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * Allied vision under recon fog of war: the ally's soldier far to the east keeps its surroundings in
 * your sight and its neighbour discovered, while a hermit beyond every eye stays unknown. The browser
 * view shows the east clearing lit with no unit of yours near it, and the diplomacy window listing the
 * neighbour; turning neutral or hostile toward the ally there fades the clearing back to grey.
 */

const MAP_W = 60;
const MAP_H = 12;

/** A mutual friend: one fog mask with the human seat while the stances hold. */
const ALLY_PLAYER = 1;
/** Stands inside the ally's eye alone, so only the shared mask can discover it for you; neutral
 *  both ways, so nobody picks a fight. */
const NEIGHBOUR_PLAYER = 2;
/** Spawned beyond every eye and staying there, so discovery has a negative to prove. */
const HERMIT_PLAYER = 3;

const HUMAN_AT = { x: 6, y: 6 } as const;
/** 34 cells east of your soldier: far beyond its 544 px eye, inside nothing of yours. */
const ALLY_AT = { x: 40, y: 6 } as const;
/** 4 cells (272 px) east of the ally, well inside its 544 px eye. */
const NEIGHBOUR_AT = { x: 44, y: 6 } as const;
/** 18 cells east of the ally (1224 px), outside its eye; the map's far corner. */
const HERMIT_AT = { x: 58, y: 11 } as const;

function build(sim: Simulation): void {
  spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, HUMAN_AT.x, HUMAN_AT.y, HUMAN_PLAYER);
  spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, ALLY_AT.x, ALLY_AT.y, ALLY_PLAYER);
  spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, NEIGHBOUR_AT.x, NEIGHBOUR_AT.y, NEIGHBOUR_PLAYER);
  spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, HERMIT_AT.x, HERMIT_AT.y, HERMIT_PLAYER);
  sim.enqueueSetup({ kind: 'setAlliedVision', enabled: true });
  sim.enqueueSetup({ kind: 'setDiplomacy', from: HUMAN_PLAYER, to: ALLY_PLAYER, state: 'friend' });
  sim.enqueueSetup({ kind: 'setDiplomacy', from: ALLY_PLAYER, to: HUMAN_PLAYER, state: 'friend' });
  for (const player of [HUMAN_PLAYER, ALLY_PLAYER]) {
    sim.enqueueSetup({ kind: 'setDiplomacy', from: player, to: NEIGHBOUR_PLAYER, state: 'neutral' });
    sim.enqueueSetup({ kind: 'setDiplomacy', from: NEIGHBOUR_PLAYER, to: player, state: 'neutral' });
  }
}

/** The human seat's raw fog state at visual cell (x, y). */
function humanSees(sim: Simulation, at: { readonly x: number; readonly y: number }): boolean {
  const node = cellAnchorNode(at.x, at.y);
  const cell = systems.cellOfNode(node.hx, node.hy);
  return sim.fog?.stateAt(HUMAN_PLAYER, cell.cx, cell.cy) === FOG_STATE.VISIBLE;
}

export const alliedVisionScene: SceneDefinition = {
  id: 'allied-vision',
  seed: 37,
  terrain: grassTerrain(MAP_W, MAP_H),
  fog: 'recon-fow',
  build,
  runTicks: 60,
  initialZoom: 0.8,
  checks: [
    {
      label: "the ally's soldier keeps its clearing in your sight through the one shared mask",
      predicate: (sim) =>
        sim.fog?.visionGroupOf(ALLY_PLAYER) === HUMAN_PLAYER &&
        humanSees(sim, ALLY_AT) &&
        humanSees(sim, NEIGHBOUR_AT) &&
        !humanSees(sim, HERMIT_AT),
    },
    {
      label: "the neighbour inside the ally's eye is discovered for you, the hermit beyond it is not",
      predicate: (sim) =>
        sim.hasMetPlayer(HUMAN_PLAYER, ALLY_PLAYER) &&
        sim.hasMetPlayer(HUMAN_PLAYER, NEIGHBOUR_PLAYER) &&
        !sim.hasMetPlayer(HUMAN_PLAYER, HERMIT_PLAYER),
    },
  ],
};
