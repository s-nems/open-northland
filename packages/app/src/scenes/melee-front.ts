import { cellAnchorNode, components, type Entity, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_SOLDIER_SPEAR, JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import { spawnSettlerDirect } from '../game/sandbox/index.js';
import { createSceneSim } from './runtime.js';
import { blueLivingSettlers, enemyLivingSettlers } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * Two warbands ordered at each other across open ground meet as a front: the men at the seam fight, the
 * rear presses into the gaps beside them instead of queueing behind a friend, and nobody piles onto one
 * enemy. The larger band wins by wrapping the smaller one's flanks. No formation is ordered; the front is
 * what the target pick and the step along the front make of body collision. The browser view shows the
 * two lines meeting, the rear stepping into the seams, and the wrap.
 */

const MAP_W = 44;
const MAP_H = 26;

/** Three columns a side; the inner columns face each other 30 map points apart, past the sight radius, so
 *  each band walks up under its attack-move rather than spotting the other from where it stands. */
const COLUMNS = 3;
const BLUE_FIRST_COLUMN = 8;
const RED_FIRST_COLUMN = 25;
const FIRST_ROW = 8;
/** Thirty blue to twenty-seven red: the smaller band is the one the front has to keep busy. */
const BLUE_LAST_ROW = 17;
const RED_LAST_ROW = 16;
/** Swordsmen and spearmen alternate by row, so both reaches meet at the seam. */
const JOBS_BY_ROW: readonly number[] = [JOB_SOLDIER_SWORD, JOB_SOLDIER_SPEAR];

/** The bands meet around tick 125 and the last red man falls around tick 315. */
const RUN_TICKS = 400;

/** Bodies collide, so the men who can strike one enemy at once are the ones on its free sides; four is
 *  where a crowd starts to read as a pile. The cap is asked while the smaller band still has more men than
 *  it: once the last few stand alone, the whole larger band closing on them is the wrap, not a pile. */
const MAX_STRIKERS_ON_ONE = 4;
/** Share of the smaller band that fought, landing a blow or taking one: the rear is not idle for the whole
 *  fight. */
const MIN_ENGAGED_SHARE = 0.6;

const { CurrentAtomic, Health, Owner, Settler } = components;

const RED_COUNT = COLUMNS * (RED_LAST_ROW - FIRST_ROW + 1);

/** A band of `owner` in the columns from `firstColumn`, each man ordered to attack-move onto the other
 *  band's ground, one command per unit as the player's formation order issues them. */
function band(sim: Simulation, owner: number, firstColumn: number, lastRow: number, toColumn: number): void {
  for (let y = FIRST_ROW; y <= lastRow; y++) {
    const job = JOBS_BY_ROW[y % JOBS_BY_ROW.length] ?? JOB_SOLDIER_SWORD;
    for (let column = 0; column < COLUMNS; column++) {
      const warrior = spawnSettlerDirect(sim, job, firstColumn + column, y, owner);
      const goal = cellAnchorNode(toColumn + column, y);
      sim.enqueueSetup({ kind: 'attackMoveUnit', entity: warrior, x: goal.hx, y: goal.hy });
    }
  }
}

function build(sim: Simulation): void {
  band(sim, HUMAN_PLAYER, BLUE_FIRST_COLUMN, BLUE_LAST_ROW, RED_FIRST_COLUMN);
  band(sim, ENEMY_PLAYER, RED_FIRST_COLUMN, RED_LAST_ROW, BLUE_FIRST_COLUMN);
}

/** What a fresh run of the scene shows tick by tick: the most men swinging at one living enemy in any tick
 *  while the red band still outnumbers {@link MAX_STRIKERS_ON_ONE}, the red men who fought, and the tick
 *  the fight ended. */
interface MeleeFrontObservation {
  readonly maxStrikersOnOne: number;
  readonly redEngaged: number;
  readonly redCount: number;
  readonly endedAt: number | null;
}

/** Re-simulate the scene, sampling after every step. A full run, so a check pays it only once. */
function observeMeleeFront(ticks: number): MeleeFrontObservation {
  const sim = createSceneSim(meleeFrontScene);
  let maxStrikersOnOne = 0;
  const redEngaged = new Set<Entity>();
  let endedAt: number | null = null;
  for (let i = 0; i < ticks; i++) {
    sim.step();
    if (enemyLivingSettlers(sim) > MAX_STRIKERS_ON_ONE) {
      const strikers = new Map<Entity, number>();
      for (const e of sim.world.query(Settler, Owner, CurrentAtomic)) {
        const effect = sim.world.get(e, CurrentAtomic).effect;
        if (effect.kind !== 'attack') continue;
        if ((sim.world.tryGet(effect.target, Health)?.hitpoints ?? 0) <= 0) continue;
        strikers.set(effect.target, (strikers.get(effect.target) ?? 0) + 1);
      }
      for (const n of strikers.values()) maxStrikersOnOne = Math.max(maxStrikersOnOne, n);
    }
    for (const ev of sim.events.current()) {
      if (ev.kind !== 'combatHit') continue;
      for (const e of [ev.attacker, ev.target]) {
        if (sim.world.tryGet(e, Owner)?.player === ENEMY_PLAYER) redEngaged.add(e);
      }
    }
    if (endedAt === null && (blueLivingSettlers(sim) === 0 || enemyLivingSettlers(sim) === 0)) {
      endedAt = sim.tick;
    }
  }
  return { maxStrikersOnOne, redEngaged: redEngaged.size, redCount: RED_COUNT, endedAt };
}

let observed: MeleeFrontObservation | undefined;
function observation(): MeleeFrontObservation {
  observed ??= observeMeleeFront(RUN_TICKS);
  return observed;
}

export const meleeFrontScene: SceneDefinition = {
  id: 'melee-front',
  seed: 33,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.6,
  checks: [
    {
      label: 'no enemy has more than four men striking it in one tick while the smaller band holds a front',
      predicate: () => observation().maxStrikersOnOne <= MAX_STRIKERS_ON_ONE,
    },
    {
      label: 'most of the smaller band fought: landed a blow or took one',
      predicate: () => observation().redEngaged >= Math.ceil(MIN_ENGAGED_SHARE * RED_COUNT),
    },
    {
      label: 'the fight ends with the smaller band dead and the larger one standing',
      predicate: (sim) => enemyLivingSettlers(sim) === 0 && blueLivingSettlers(sim) > 0,
    },
  ],
};
