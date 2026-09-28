import type { HalfCellNode, Simulation } from '@open-northland/sim';
import { cellAnchorNode, components, nodeOfPosition, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
} from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import { spawnSettlerAtNode } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

const { Health, Owner, Position, Settler, Stance, WalkFacing } = components;
const { E, SE, SW, W, NW, NE, N, S } = components.WALK_DIRECTION;

/** One row of lanes per weapon class, fists to longbow. */
const WEAPON_JOBS = [
  JOB_SOLDIER_UNARMED,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_BROADSWORD,
  JOB_ARCHER,
  JOB_ARCHER_LONG,
] as const;
const RANGED_JOBS: readonly number[] = [JOB_ARCHER, JOB_ARCHER_LONG];
/** The weapons that strike one node out; the rest of the melee reach two. */
const SHORT_REACH_JOBS: readonly number[] = [JOB_SOLDIER_UNARMED, JOB_SOLDIER_SWORD];

interface NodeStep {
  readonly hx: number;
  readonly hy: number;
  /** One node down or up is a hex neighbour on the east side only from an odd node row. */
  readonly fromOddRow?: true;
}

/**
 * One column of lanes per heading, as the half-cell node step from attacker to target, one node and two
 * nodes of reach. A node is 34 px across and 19 px down, so (1, 1) and (1, 2) are south-east and (0, 1)
 * and (0, 2) straight south.
 */
const HEADINGS: readonly { facing: number; near: NodeStep; far: NodeStep }[] = [
  { facing: E, near: { hx: 1, hy: 0 }, far: { hx: 2, hy: 0 } },
  { facing: SE, near: { hx: 1, hy: 1, fromOddRow: true }, far: { hx: 1, hy: 2 } },
  { facing: S, near: { hx: 0, hy: 1 }, far: { hx: 0, hy: 2 } },
  { facing: SW, near: { hx: -1, hy: 1 }, far: { hx: -1, hy: 2 } },
  { facing: W, near: { hx: -1, hy: 0 }, far: { hx: -2, hy: 0 } },
  { facing: NW, near: { hx: -1, hy: -1 }, far: { hx: -1, hy: -2 } },
  { facing: N, near: { hx: 0, hy: -1 }, far: { hx: 0, hy: -2 } },
  { facing: NE, near: { hx: 1, hy: -1, fromOddRow: true }, far: { hx: 1, hy: -2 } },
];

/** An archer shoots from twice the long step, inside the short bow's reach. */
const RANGED_STEPS = 2;
/** Lane spacing in cells, wide enough that no attacker prefers a neighbouring lane's target. */
const LANE_COLUMNS = 10;
const LANE_ROWS = 14;
const MARGIN = 6;
const MAP_W = MARGIN * 2 + LANE_COLUMNS * HEADINGS.length;
const MAP_H = MARGIN * 2 + LANE_ROWS * WEAPON_JOBS.length;
/** Both sides outlast the run: a struck target swings back, and the scene shows the attackers' motion. */
const HITPOINTS = 100_000;

interface Lane {
  readonly facing: number;
  readonly job: number;
  readonly attacker: HalfCellNode;
  readonly target: HalfCellNode;
}

const LANES: readonly Lane[] = WEAPON_JOBS.flatMap((job, row) =>
  HEADINGS.map(({ facing, near, far }, column): Lane => {
    const anchor = cellAnchorNode(MARGIN + column * LANE_COLUMNS, MARGIN + row * LANE_ROWS);
    const short = SHORT_REACH_JOBS.includes(job);
    const step = short ? near : far;
    const steps = RANGED_JOBS.includes(job) ? RANGED_STEPS : 1;
    const attacker = { hx: anchor.hx, hy: anchor.hy + (step.fromOddRow === true ? 1 : 0) };
    const target = { hx: attacker.hx + step.hx * steps, hy: attacker.hy + step.hy * steps };
    return { facing, job, attacker, target };
  }),
);

function spawnSturdy(sim: Simulation, job: number, node: HalfCellNode, owner: number) {
  const e = spawnSettlerAtNode(sim, job, node, owner);
  const health = sim.world.mut(e, Health);
  health.hitpoints = HITPOINTS;
  health.max = HITPOINTS;
  return e;
}

function build(sim: Simulation): void {
  for (const lane of LANES) {
    const target = spawnSturdy(sim, JOB_SOLDIER_SWORD, lane.target, ENEMY_PLAYER);
    const stance = sim.world.mut(target, Stance);
    stance.mode = systems.MILITARY_MODE.IGNORE;
    stance.anchorCell = null;
    const attacker = spawnSturdy(sim, lane.job, lane.attacker, HUMAN_PLAYER);
    sim.enqueueSetup({ kind: 'attackUnit', entity: attacker, target });
  }
}

/** Every lane's attacker still on its own node, facing its target. */
function everyLaneFacesItsTarget(sim: Simulation): boolean {
  const facingByNode = new Map<string, number | undefined>();
  for (const e of sim.world.query(Settler, Owner, Position)) {
    if (sim.world.get(e, Owner).player !== HUMAN_PLAYER) continue;
    const p = sim.world.get(e, Position);
    const node = nodeOfPosition(p.x, p.y);
    facingByNode.set(`${node.hx},${node.hy}`, sim.world.tryGet(e, WalkFacing)?.direction);
  }
  return LANES.every((lane) => facingByNode.get(`${lane.attacker.hx},${lane.attacker.hy}`) === lane.facing);
}

export const weaponFacingsScene: SceneDefinition = {
  id: 'weapon-facings',
  seed: 43,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: 120,
  initialZoom: 1.1,
  checks: [
    {
      label: 'every weapon class swings at its target from its own spot along each of the eight headings',
      predicate: everyLaneFacesItsTarget,
    },
  ],
};
