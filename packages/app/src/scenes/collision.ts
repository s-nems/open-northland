import type { Entity, Simulation } from '@open-northland/sim';
import { components, fx, nodeOfPosition, positionOfNode } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import {
  JOB_CARRIER,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
} from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER, PRIMARY_TRIBE } from '../game/rules.js';
import { holdsSometimeDuring } from './runtime.js';
import type { SceneDefinition } from './types.js';

// No Health is stamped, so hostile owners never start a fight and the scene isolates collision.

const MAP_W = 30;
const MAP_H = 20;

/** Long enough for both squads' marches to settle (the surround ring is the slowest). */
const RUN_TICKS = 700;

/** One spear-man per consecutive node, radii touching, so the line is a closed wall. */
const WALL_X = 30;
const WALL_Y_FIRST = 8;
const WALL_Y_LAST = 24;

const BREACH_START_X = 16;
const BREACH_GOAL_X = 44;
const BREACH_ROWS = [12, 14, 16, 18] as const;

/** The carriers cut straight through the middle of the wall band. */
const CARRIER_ROWS = [13, 19] as const;

/** Eight broadswords converging from an arc onto one node, south of the wall play. */
const SURROUND_GOAL = { x: 16, y: 32 } as const;
const SURROUND_STARTS: readonly { x: number; y: number }[] = [
  { x: 8, y: 28 },
  { x: 8, y: 32 },
  { x: 8, y: 36 },
  { x: 24, y: 28 },
  { x: 24, y: 32 },
  { x: 24, y: 36 },
  { x: 16, y: 26 },
  { x: 16, y: 38 },
];

/** Manhattan spread in half-cell nodes the settled ring may cover. */
const SURROUND_MAX_SPREAD = 5;

const { MoveGoal, Owner, Position, Settler } = components;

/** Placed at a node directly: the spawn command rounds to cell anchors, too coarse for the sub-node
 *  collision geometry this scene authors. */
function settlerAtNode(sim: Simulation, job: number, x: number, y: number, player: number): Entity {
  const e = sim.world.create();
  sim.world.add(e, Position, positionOfNode(x, y));
  sim.world.add(e, Settler, {
    tribe: PRIMARY_TRIBE,
    jobType: job,
    hunger: fx.fromInt(0),
    fatigue: fx.fromInt(0),
    piety: fx.fromInt(0),
    enjoyment: fx.fromInt(0),
    experience: new Map<number, number>(),
  });
  sim.world.add(e, Owner, { player });
  return e;
}

function orderTo(sim: Simulation, e: Entity, x: number, y: number): void {
  const cell = sim.terrain?.nodeAt(x, y);
  if (cell !== undefined) sim.world.add(e, MoveGoal, { cell });
}

function build(sim: Simulation): void {
  for (let y = WALL_Y_FIRST; y <= WALL_Y_LAST; y++) {
    settlerAtNode(sim, JOB_SOLDIER_SPEAR, WALL_X, y, ENEMY_PLAYER);
  }
  for (const y of BREACH_ROWS) {
    const e = settlerAtNode(sim, JOB_SOLDIER_SWORD, BREACH_START_X, y, HUMAN_PLAYER);
    orderTo(sim, e, BREACH_GOAL_X, y);
  }
  for (const y of CARRIER_ROWS) {
    const e = settlerAtNode(sim, JOB_CARRIER, BREACH_START_X, y, HUMAN_PLAYER);
    orderTo(sim, e, BREACH_GOAL_X, y);
  }
  for (const start of SURROUND_STARTS) {
    const e = settlerAtNode(sim, JOB_SOLDIER_BROADSWORD, start.x, start.y, HUMAN_PLAYER);
    orderTo(sim, e, SURROUND_GOAL.x, SURROUND_GOAL.y);
  }
}

/** Nodes as `x,y` keys. */
function nodesOf(sim: Simulation, player: number, job: number): string[] {
  const nodes: string[] = [];
  for (const e of sim.world.query(Settler, Owner, Position)) {
    if (sim.world.get(e, Owner).player !== player) continue;
    if (sim.world.get(e, Settler).jobType !== job) continue;
    const p = sim.world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    nodes.push(`${n.hx},${n.hy}`);
  }
  return nodes;
}

function breachSquadArrived(sim: Simulation): boolean {
  const want = new Set(BREACH_ROWS.map((y) => `${BREACH_GOAL_X},${y}`));
  const got = nodesOf(sim, HUMAN_PLAYER, JOB_SOLDIER_SWORD);
  return got.length === want.size && got.every((n) => want.has(n));
}

function carriersPassedThrough(sim: Simulation): boolean {
  const want = new Set(CARRIER_ROWS.map((y) => `${BREACH_GOAL_X},${y}`));
  const got = nodesOf(sim, HUMAN_PLAYER, JOB_CARRIER);
  return got.length === want.size && got.every((n) => want.has(n));
}

function wallUnmoved(sim: Simulation): boolean {
  const want = new Set<string>();
  for (let y = WALL_Y_FIRST; y <= WALL_Y_LAST; y++) want.add(`${WALL_X},${y}`);
  const got = nodesOf(sim, ENEMY_PLAYER, JOB_SOLDIER_SPEAR);
  return got.length === want.size && got.every((n) => want.has(n));
}

function surroundFormedRing(sim: Simulation): boolean {
  const got = nodesOf(sim, HUMAN_PLAYER, JOB_SOLDIER_BROADSWORD);
  if (got.length !== SURROUND_STARTS.length) return false;
  if (new Set(got).size !== got.length) return false; // no stacking
  let goalTaken = false;
  for (const key of got) {
    const [x, y] = key.split(',').map(Number);
    if (x === undefined || y === undefined) return false;
    if (Math.abs(x - SURROUND_GOAL.x) + Math.abs(y - SURROUND_GOAL.y) > SURROUND_MAX_SPREAD) return false;
    if (x === SURROUND_GOAL.x && y === SURROUND_GOAL.y) goalTaken = true;
  }
  return goalTaken; // the first arrival holds the exact node; the rest ring it
}

export const collisionScene: SceneDefinition = {
  id: 'collision',
  seed: 11,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.8,
  checks: [
    {
      label: 'the blue sword squad routed around the wall and reached its goals',
      predicate: breachSquadArrived,
    },
    { label: 'no wall spear-man was displaced from his node', predicate: wallUnmoved },
    {
      label: 'the surround squad settled into a distinct-node ring on and around the goal',
      predicate: surroundFormedRing,
    },
    {
      // Arrived carriers are idle civilians and idle settlers wander off to gossip, so the end tick
      // can find one beside its colleague instead of on its goal node.
      label: 'the carriers walked straight through the wall (civilian pass-through)',
      predicate: (sim) =>
        carriersPassedThrough(sim) || holdsSometimeDuring(collisionScene, RUN_TICKS, carriersPassedThrough),
    },
  ],
};
