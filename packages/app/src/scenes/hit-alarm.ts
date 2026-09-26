import {
  cellAnchorNode,
  components,
  type Entity,
  fx,
  hexDistanceBetween,
  type MilitaryMode,
  nodeOfPosition,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_ARCHER, JOB_CIVILIST, JOB_HUNTER, JOB_SOLDIER_SWORD, JOB_WOMAN } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import { spawnSettlerDirect } from '../game/sandbox/index.js';
import { holdsSometimeDuring } from './runtime.js';
import { enemyLivingSettlers } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * The alarm a blow raises. A red archer is sent against a blue woman told to ignore the enemy; the arrow
 * in her sends her running anyway, and the hunter beside her with her, while a civilian set to DEFEND
 * stands. Blue swordsmen too far off to see the archer turn on him the moment she is hit and cut him
 * down. The browser view shows the runs, the swordsmen setting off, and the kill.
 */

const MAP_W = 40;
const MAP_H = 14;

const ROW = 7;
const ARCHER_AT = { x: 3, y: ROW } as const;
const WOMAN_AT = { x: 14, y: ROW } as const;
/** Beside her, inside the blow's alarm for people. */
const HUNTER_AT = { x: 17, y: ROW } as const;
const STEADY_AT = { x: 17, y: ROW + 2 } as const;
/** Past the swordsmen's own sight of the archer, inside the blow's alarm for soldiers. */
const SOLDIER_X = 27;
const SOLDIER_ROWS: readonly number[] = [ROW - 1, ROW, ROW + 1];
/** Shot at all the while the swordsmen cross: the runs need a blow to follow, and the alarm a victim. */
const MARK_HITPOINTS = 100_000;
/** A run from a blow is ten map points, five cells along the row; a diagonal run keeps that much easting. */
const RAN_CELLS = 4;
const RUN_TICKS = 700;

const { Engagement, Fleeing, Health, Owner, Position, Settler, Stance } = components;

function setStance(sim: Simulation, e: Entity, mode: MilitaryMode): void {
  const stance = sim.world.mut(e, Stance);
  stance.mode = mode;
  stance.anchorCell = null;
}

function build(sim: Simulation): void {
  const woman = spawnSettlerDirect(sim, JOB_WOMAN, WOMAN_AT.x, WOMAN_AT.y, HUMAN_PLAYER);
  setStance(sim, woman, systems.MILITARY_MODE.IGNORE); // told to ignore the enemy, not to run at the sight of him
  sim.world.mut(woman, Health).hitpoints = MARK_HITPOINTS;
  sim.world.mut(woman, Health).max = MARK_HITPOINTS;
  spawnSettlerDirect(sim, JOB_HUNTER, HUNTER_AT.x, HUNTER_AT.y, HUMAN_PLAYER); // IGNORE by trade
  const steady = spawnSettlerDirect(sim, JOB_CIVILIST, STEADY_AT.x, STEADY_AT.y, HUMAN_PLAYER);
  setStance(sim, steady, systems.MILITARY_MODE.DEFEND);
  for (const y of SOLDIER_ROWS) spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, SOLDIER_X, y, HUMAN_PLAYER);
  const archer = spawnSettlerDirect(sim, JOB_ARCHER, ARCHER_AT.x, ARCHER_AT.y, ENEMY_PLAYER);
  sim.enqueueSetup({ kind: 'attackUnit', entity: archer, target: woman });
}

function blueOfJob(sim: Simulation, jobType: number): Entity[] {
  const out: Entity[] = [];
  for (const e of sim.world.query(Settler, Owner, Position)) {
    if (sim.world.get(e, Owner).player === HUMAN_PLAYER && sim.world.get(e, Settler).jobType === jobType) {
      out.push(e);
    }
  }
  return out;
}

function theArcher(sim: Simulation): Entity | undefined {
  for (const e of sim.world.query(Settler, Owner, Position)) {
    if (sim.world.get(e, Owner).player === ENEMY_PLAYER) return e;
  }
  return undefined;
}

function nodeDistance(sim: Simulation, a: Entity, b: Entity): number {
  const p = nodeOfPosition(sim.world.get(a, Position).x, sim.world.get(a, Position).y);
  const q = nodeOfPosition(sim.world.get(b, Position).x, sim.world.get(b, Position).y);
  return hexDistanceBetween(p.hx, p.hy, q.hx, q.hy);
}

/** Whether every swordsman holds the archer as its target while none of them could see him yet. */
function alarmedPastSight(sim: Simulation): boolean {
  const archer = theArcher(sim);
  if (archer === undefined) return false;
  const swordsmen = blueOfJob(sim, JOB_SOLDIER_SWORD);
  return (
    swordsmen.length > 0 &&
    swordsmen.every(
      (e) =>
        sim.world.tryGet(e, Engagement)?.target === archer &&
        nodeDistance(sim, e, archer) > systems.SIGHT_RADIUS_NODES,
    )
  );
}

function ranEast(sim: Simulation, jobType: number, from: { readonly x: number }): boolean {
  return blueOfJob(sim, jobType).some((e) => sim.world.get(e, Position).x >= fx.fromInt(from.x + RAN_CELLS));
}

function steadyRan(sim: Simulation): boolean {
  return blueOfJob(sim, JOB_CIVILIST).some((e) => sim.world.has(e, Fleeing));
}

export const hitAlarmScene: SceneDefinition = {
  id: 'hit-alarm',
  seed: 11,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.7,
  checks: [
    {
      label: 'the swordsmen stand past their sight of the archer, inside the alarm the shot raises',
      predicate: () => {
        const soldier = cellAnchorNode(SOLDIER_X, ROW);
        const woman = cellAnchorNode(WOMAN_AT.x, WOMAN_AT.y);
        const apart = hexDistanceBetween(soldier.hx, soldier.hy, woman.hx, woman.hy);
        return apart > systems.SIGHT_RADIUS_NODES && apart <= systems.ALARM_SOLDIER_RADIUS_NODES;
      },
    },
    {
      label: 'the swordsmen turned on the archer while he was still out of their sight',
      predicate: () => holdsSometimeDuring(hitAlarmScene, RUN_TICKS, alarmedPastSight),
    },
    {
      label: 'the woman, told to ignore the enemy, ran from the arrow in her',
      predicate: () =>
        holdsSometimeDuring(hitAlarmScene, RUN_TICKS, (sim) => ranEast(sim, JOB_WOMAN, WOMAN_AT)),
    },
    {
      label: 'the hunter beside her ran from the blow too',
      predicate: () =>
        holdsSometimeDuring(hitAlarmScene, RUN_TICKS, (sim) => ranEast(sim, JOB_HUNTER, HUNTER_AT)),
    },
    {
      label: 'the civilian set to DEFEND never ran',
      predicate: () => !holdsSometimeDuring(hitAlarmScene, RUN_TICKS, steadyRan),
    },
    {
      label: 'the archer is cut down',
      predicate: (sim) => enemyLivingSettlers(sim) === 0,
    },
  ],
};
