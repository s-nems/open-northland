import {
  cellAnchorNode,
  components,
  type Entity,
  hexDistanceBetween,
  nodeOfPosition,
  type Simulation,
  systems,
} from '@open-northland/sim';
import { ANIMAL_TRIBE_WOLVES } from '../catalog/animal-tribes.js';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_CIVILIST, JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import { spawnSettlerDirect } from '../game/sandbox/index.js';
import { holdsSometimeDuring } from './runtime.js';
import type { SceneDefinition } from './types.js';

/**
 * A wolf pack fights back away from home. The pack runs a scout down the row to the end of its leash and
 * turns for home, where swordsmen on an attack-move meet it, well off the circle round its stay point that
 * the leader searches. The first blow rouses the whole pack, leader included, rather than leaving the rest
 * to walk home past the swordsmen. The browser view shows the chase, the turn and the fight.
 */

const MAP_W = 46;
const MAP_H = 14;

const ROW = 7;
const PACK_AT = { x: 6, y: ROW } as const;
/** Inside the leader's search circle, so the pack sets off after him. */
const SCOUT_AT = { x: 14, y: ROW } as const;
const SWORD_X = 42;
const SWORD_ROWS: readonly number[] = [ROW - 1, ROW, ROW + 1];
const RUN_TICKS = 900;

const { Engagement, HerdMember, Position, Settler, StayPoint } = components;

function build(sim: Simulation): void {
  const pack = cellAnchorNode(PACK_AT.x, PACK_AT.y);
  sim.enqueueSetup({ kind: 'spawnAnimalHerd', tribe: ANIMAL_TRIBE_WOLVES, x: pack.hx, y: pack.hy });
  spawnSettlerDirect(sim, JOB_CIVILIST, SCOUT_AT.x, SCOUT_AT.y, HUMAN_PLAYER);
  for (const y of SWORD_ROWS) {
    const sword = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, SWORD_X, y, HUMAN_PLAYER);
    const goal = cellAnchorNode(PACK_AT.x, y);
    sim.enqueueSetup({ kind: 'attackMoveUnit', entity: sword, x: goal.hx, y: goal.hy });
  }
}

function wolves(sim: Simulation): Entity[] {
  const out: Entity[] = [];
  for (const e of sim.world.query(Settler, Position)) {
    if (sim.world.get(e, Settler).tribe === ANIMAL_TRIBE_WOLVES) out.push(e);
  }
  return out;
}

function leader(sim: Simulation): Entity | undefined {
  return wolves(sim).find((e) => sim.world.tryGet(e, HerdMember)?.leader === e);
}

/** How far, in map points, the wolf stands from its own stay point. */
function offStay(sim: Simulation, wolf: Entity): number {
  const terrain = sim.terrain;
  if (terrain === undefined) return 0;
  const p = sim.world.get(wolf, Position);
  const at = nodeOfPosition(p.x, p.y);
  const stay = sim.world.get(wolf, StayPoint).cell;
  return hexDistanceBetween(at.hx, at.hy, terrain.xOf(stay), terrain.yOf(stay));
}

function targetJob(sim: Simulation, wolf: Entity): number | null | undefined {
  const target = sim.world.tryGet(wolf, Engagement)?.target;
  return target === undefined ? undefined : sim.world.tryGet(target, Settler)?.jobType;
}

/** Whether `wolf` holds a target of `jobType` while standing off the leader's search circle. */
function huntsOffCircle(sim: Simulation, wolf: Entity | undefined, jobType: number): boolean {
  return (
    wolf !== undefined &&
    targetJob(sim, wolf) === jobType &&
    offStay(sim, wolf) > systems.ANIMAL_AGGRO_RADIUS_NODES
  );
}

export const wolfPackScene: SceneDefinition = {
  id: 'wolf-pack',
  seed: 41,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.7,
  checks: [
    {
      label: 'the pack runs the scout down past the circle its leader searches',
      predicate: () =>
        holdsSometimeDuring(wolfPackScene, RUN_TICKS, (s) => huntsOffCircle(s, leader(s), JOB_CIVILIST)),
    },
    {
      label: 'the leader turns on the swordsmen there, far from its stay point',
      predicate: () =>
        holdsSometimeDuring(wolfPackScene, RUN_TICKS, (s) => huntsOffCircle(s, leader(s), JOB_SOLDIER_SWORD)),
    },
    {
      label: 'the swordsmen cut the whole pack down',
      predicate: (sim) => wolves(sim).length === 0,
    },
  ],
};
