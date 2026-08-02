import { cellAnchorNode, components, type Entity, fx, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_SOLDIER_SPEAR, JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import { spawnSettlerDirect } from '../game/sandbox/index.js';
import { enemyLivingSettlers } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * The attack-move scene - a warband ordered to fight its way across the map. It signs off the
 * `attackMoveUnit` order: unlike a plain move order (which benches every auto-drive until arrival), the
 * march keeps the combat drives live, so the warband breaks off to kill the picket standing in its path
 * and then walks on to the spot it was sent to.
 *
 * The picket is stood down to IGNORE so it never starts a fight of its own. That makes the run a real
 * discriminator: under a plain `moveUnit` the blue rank would file straight through untouched reds, so
 * "the picket is dead AND blue stands at the ordered column" can only be the march's doing.
 */

const MAP_W = 34;
const MAP_H = 14;

/** The blue warband: two ranks on the left edge, ordered to the far right column. */
const BLUE_X: readonly number[] = [2, 3];
const BLUE_Y_FIRST = 5;
const BLUE_Y_LAST = 8;

/** The red picket, halfway along the route - passive, so only an attack-moving warband ever fights it. */
const PICKET_X = 16;
const PICKET_Y: readonly number[] = [5, 6, 7, 8];

/** The ordered destination column, well beyond the picket. */
const GOAL_X = 30;

/** How far right (in cells) a blue unit must stand to count as "arrived at the ordered column" - the
 *  formation fans the rank out around the clicked tile, so arrival is a band, not one exact column. */
const ARRIVED_X = GOAL_X - 3;

/** How many of the eight marchers must reach {@link ARRIVED_X}. Below the full rank: the fight scatters the
 *  formation, so the last stragglers are still closing when the run ends. */
const ARRIVED_MIN = 6;

const { Owner, Position, Settler, Stance } = components;

function build(sim: Simulation): void {
  for (const x of BLUE_X) {
    for (let y = BLUE_Y_FIRST; y <= BLUE_Y_LAST; y++) {
      const warrior = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, x, y, HUMAN_PLAYER);
      // The order the player would issue with A + left-click, enqueued at build so the headless twin and
      // the browser run the same march. One command per unit, as the formation click issues.
      const goal = cellAnchorNode(GOAL_X, y);
      sim.enqueue({ kind: 'attackMoveUnit', entity: warrior, x: goal.hx, y: goal.hy });
    }
  }
  for (const y of PICKET_Y)
    standDown(sim, spawnSettlerDirect(sim, JOB_SOLDIER_SPEAR, PICKET_X, y, ENEMY_PLAYER));
}

/** Stand a unit down to IGNORE - it defends itself but never auto-acquires. */
function standDown(sim: Simulation, e: Entity): void {
  sim.world.write(e, Stance, (stance) => {
    stance.mode = systems.MILITARY_MODE.IGNORE;
    stance.anchorCell = null;
  });
}

/** Blue units standing at or beyond {@link ARRIVED_X} - the march's far end. */
function blueArrived(sim: Simulation): number {
  let n = 0;
  for (const e of sim.world.query(Settler, Owner, Position)) {
    if (sim.world.get(e, Owner).player !== HUMAN_PLAYER) continue;
    if (sim.world.get(e, Position).x >= fx.fromInt(ARRIVED_X)) n++;
  }
  return n;
}

// runTicks covers the whole march: walk in, cut the picket down, walk on to the ordered column.
export const attackMoveScene: SceneDefinition = {
  id: 'attack-move',
  seed: 5,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: 900,
  initialZoom: 0.8,
  checks: [
    {
      // The march fights: a passive picket on the route is cut down, which a plain move order never does.
      label: 'the picket standing in the warband’s path is cut down',
      predicate: (sim) => enemyLivingSettlers(sim) === 0,
    },
    {
      // And it resumes: the fight is a detour, not the end of the order.
      label: 'the warband walks on and reaches the ordered column',
      predicate: (sim) => blueArrived(sim) >= ARRIVED_MIN,
    },
  ],
};
