import { cellAnchorNode, components, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_SOLDIER_SWORD, JOB_WOMAN } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import { spawnSettlerDirect } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * The skirmish rule end to end: three swordsmen cut down the rival seat's lone man, the MatchSystem
 * finds that seat without an adult man at its next check and declares it dead, and the human seat wins
 * as the last one standing. The rival's woman survives the verdict, proving she kept nobody alive. The
 * browser view pairs this with the verdict panel and the won jingle.
 */

const MAP_W = 24;
const MAP_H = 12;

const WARBAND_X = 6;
const WARBAND_Y = 6;
const WARBAND_SIZE = 3;
const RIVAL_AT = { x: 15, y: 6 } as const;
/** The far corner: past the warband's sight and the blow's alarm once the rival falls, so she neither runs
 *  nor draws the swordsmen on, and stands there when the verdict comes. */
const RIVAL_WOMAN_AT = { x: 22, y: 11 } as const;

/** The first death check past the grace period; the fight is over well before it. */
const FIRST_CHECK_TICK =
  Math.ceil(systems.MATCH_DEATH_GRACE_TICKS / systems.MATCH_DEATH_CHECK_INTERVAL_TICKS) *
  systems.MATCH_DEATH_CHECK_INTERVAL_TICKS;
/** A few ticks past the verdict, so the check has fired when the headless run inspects the world. */
const RUN_TICKS = FIRST_CHECK_TICK + 50;

const { Owner, Person } = components;

function build(sim: Simulation): void {
  const rivalMan = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, RIVAL_AT.x, RIVAL_AT.y, ENEMY_PLAYER);
  spawnSettlerDirect(sim, JOB_WOMAN, RIVAL_WOMAN_AT.x, RIVAL_WOMAN_AT.y, ENEMY_PLAYER);
  const target = cellAnchorNode(RIVAL_AT.x, RIVAL_AT.y);
  for (let i = 0; i < WARBAND_SIZE; i++) {
    const soldier = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, WARBAND_X, WARBAND_Y - 1 + i, HUMAN_PLAYER);
    sim.enqueueSetup({ kind: 'attackUnit', entity: soldier, target: rivalMan });
  }
  sim.enqueueSetup({ kind: 'attackMoveUnit', entity: rivalMan, x: target.hx, y: target.hy });
}

function livingPersonsOf(sim: Simulation, owner: number): number {
  let count = 0;
  for (const e of sim.world.query(Person, Owner)) {
    if (sim.world.get(e, Owner).player === owner) count++;
  }
  return count;
}

export const victoryScene: SceneDefinition = {
  id: 'victory',
  seed: 31,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  participants: [HUMAN_PLAYER, ENEMY_PLAYER],
  checks: [
    {
      label: 'the rival seat is defeated',
      predicate: (sim) => sim.matchOutcome(ENEMY_PLAYER) === 'defeat',
    },
    {
      label: 'the human seat won',
      predicate: (sim) => sim.matchOutcome(HUMAN_PLAYER) === 'victory',
    },
    {
      label: "the rival's woman outlived the verdict",
      predicate: (sim) => livingPersonsOf(sim, ENEMY_PLAYER) === 1,
    },
    {
      label: 'the warband is still standing',
      predicate: (sim) => livingPersonsOf(sim, HUMAN_PLAYER) === WARBAND_SIZE,
    },
  ],
};
