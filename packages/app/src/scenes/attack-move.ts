import { cellAnchorNode, components, type Entity, fx, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_SOLDIER_SPEAR, JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import { spawnSettlerDirect } from '../game/sandbox/index.js';
import { enemyLivingSettlers } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 34;
const MAP_H = 14;

const BLUE_X: readonly number[] = [2, 3];
const BLUE_Y_FIRST = 5;
const BLUE_Y_LAST = 8;

/** Halfway along the route and passive, so only an attack-moving warband ever fights it. */
const PICKET_X = 16;
const PICKET_Y: readonly number[] = [5, 6, 7, 8];

/** The ordered destination column, well beyond the picket. */
const GOAL_X = 30;

/** Arrival is a band in cells, not one column: the formation fans the rank out around the clicked tile. */
const ARRIVED_X = GOAL_X - 3;

/** Below the full rank: the fight scatters the formation, so stragglers are still closing at the end. */
const ARRIVED_MIN = 6;

const { Owner, Position, Settler, Stance } = components;

function build(sim: Simulation): void {
  for (const x of BLUE_X) {
    for (let y = BLUE_Y_FIRST; y <= BLUE_Y_LAST; y++) {
      const warrior = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, x, y, HUMAN_PLAYER);
      // One command per unit, as the player's A + left-click formation order issues.
      const goal = cellAnchorNode(GOAL_X, y);
      sim.enqueue({ kind: 'attackMoveUnit', entity: warrior, x: goal.hx, y: goal.hy });
    }
  }
  for (const y of PICKET_Y)
    standDown(sim, spawnSettlerDirect(sim, JOB_SOLDIER_SPEAR, PICKET_X, y, ENEMY_PLAYER));
}

/** IGNORE lets a unit defend itself but never auto-acquire. */
function standDown(sim: Simulation, e: Entity): void {
  sim.world.write(e, Stance, (stance) => {
    stance.mode = systems.MILITARY_MODE.IGNORE;
    stance.anchorCell = null;
  });
}

function blueArrived(sim: Simulation): number {
  let n = 0;
  for (const e of sim.world.query(Settler, Owner, Position)) {
    if (sim.world.get(e, Owner).player !== HUMAN_PLAYER) continue;
    if (sim.world.get(e, Position).x >= fx.fromInt(ARRIVED_X)) n++;
  }
  return n;
}

export const attackMoveScene: SceneDefinition = {
  id: 'attack-move',
  seed: 5,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: 900,
  initialZoom: 0.8,
  checks: [
    {
      label: 'the picket standing in the warband’s path is cut down',
      predicate: (sim) => enemyLivingSettlers(sim) === 0,
    },
    {
      label: 'the warband walks on and reaches the ordered column',
      predicate: (sim) => blueArrived(sim) >= ARRIVED_MIN,
    },
  ],
};
