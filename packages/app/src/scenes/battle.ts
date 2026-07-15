import type { Simulation } from '@open-northland/sim';
import { components, nodeOfPosition } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import {
  JOB_ARCHER,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  spawnSandboxSettler,
  WEAPON_BROADSWORD,
  WEAPON_SHORT_BOW,
  WEAPON_SPEAR,
  WEAPON_SWORD,
} from '../game/sandbox/index.js';
import { blueLivingSettlers, enemyLivingSettlers } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * The mass-battle feel scene — 100 fighters a side in mirrored four-rank armies (swords front, then
 * spears, broadswords, archers), auto-engaging on owner hostility. The crowd-scale sign-off for the
 * body-collision work: the failure mode it judges is a converging army collapsing into one vibrating
 * pile on the closest few contact cells. With melee slots (`approachCell` deals free band cells; a full
 * band makes the chaser stand as a second rank) and body separation, the expected picture is a battle
 * line: first ranks fighting along the whole front, second ranks standing behind, units stepping into
 * gaps as front-liners fall.
 *
 * Both sides get the settler HP from the loaded content's tribe (`settlerHitpoints`, one value for every
 * spawn — no per-scene override), and the sandbox weapon damages are transcribed on the real scale
 * (`game/sandbox/combat.ts`), so the headless twin resolves combat like the browser on real content. The
 * outcome is deterministic from the seed but not scripted, so the headless checks assert crowd-shape
 * properties (the battle really runs at scale; nobody stacks), not a winner.
 */

const MAP_W = 34;
const MAP_H = 42;

/** Rank depth (cell column per weapon class) and the shared front width, in cells. */
const RANK_ROWS_FIRST = 8;
const RANK_ROWS_LAST = 32; // 25 units per rank × 4 ranks = 100 a side
const BLUE_RANKS: readonly { job: number; weapon: number; x: number }[] = [
  { job: JOB_ARCHER, weapon: WEAPON_SHORT_BOW, x: 10 },
  { job: JOB_SOLDIER_BROADSWORD, weapon: WEAPON_BROADSWORD, x: 11 },
  { job: JOB_SOLDIER_SPEAR, weapon: WEAPON_SPEAR, x: 12 },
  { job: JOB_SOLDIER_SWORD, weapon: WEAPON_SWORD, x: 13 },
];
const RED_RANKS: readonly { job: number; weapon: number; x: number }[] = [
  { job: JOB_SOLDIER_SWORD, weapon: WEAPON_SWORD, x: 20 },
  { job: JOB_SOLDIER_SPEAR, weapon: WEAPON_SPEAR, x: 21 },
  { job: JOB_SOLDIER_BROADSWORD, weapon: WEAPON_BROADSWORD, x: 22 },
  { job: JOB_ARCHER, weapon: WEAPON_SHORT_BOW, x: 23 },
];

/** The mechanic checks below: how many fighters (of 200) must have fallen for "the battle really
 *  happened at scale", and the most living fighters ever tolerated on one node at the end (transient
 *  soft overlap allows 2; 3+ standing on a node is the stacking the collision work forbids). */
const MIN_CASUALTIES = 60;
const MAX_FIGHTERS_PER_NODE = 2;

/** One army's muster, derived from the rank layout (both sides field the same count). */
const SPAWNED_PER_SIDE = (RANK_ROWS_LAST - RANK_ROWS_FIRST + 1) * BLUE_RANKS.length;

const { Owner, Position, Settler } = components;

function build(sim: Simulation): void {
  for (let y = RANK_ROWS_FIRST; y <= RANK_ROWS_LAST; y++) {
    for (const rank of BLUE_RANKS) {
      spawnSandboxSettler(sim, rank.job, rank.x, y, HUMAN_PLAYER, { weaponTypeId: rank.weapon });
    }
    for (const rank of RED_RANKS) {
      spawnSandboxSettler(sim, rank.job, rank.x, y, ENEMY_PLAYER, { weaponTypeId: rank.weapon });
    }
  }
}

function casualties(sim: Simulation): number {
  return 2 * SPAWNED_PER_SIDE - blueLivingSettlers(sim) - enemyLivingSettlers(sim);
}

/** No node holds a stack of living fighters — the crowd stays bodies, not a pile of sprites. */
function nobodyStacks(sim: Simulation): boolean {
  const perNode = new Map<string, number>();
  for (const e of sim.world.query(Settler, Owner, Position)) {
    const p = sim.world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    const key = `${n.hx},${n.hy}`;
    const count = (perNode.get(key) ?? 0) + 1;
    if (count > MAX_FIGHTERS_PER_NODE) return false;
    perNode.set(key, count);
  }
  return true;
}

export const battleScene: SceneDefinition = {
  id: 'battle',
  seed: 23,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: 1500,
  initialZoom: 0.55,
  checks: [
    {
      label: 'the battle really ran at scale (enough casualties on the field)',
      predicate: (sim) => casualties(sim) >= MIN_CASUALTIES,
    },
    {
      label: 'no node ever ends holding a stack of living fighters',
      predicate: nobodyStacks,
    },
    {
      label: 'both armies engaged (casualties are not one-sided spawn losses)',
      predicate: (sim) =>
        blueLivingSettlers(sim) < SPAWNED_PER_SIDE && enemyLivingSettlers(sim) < SPAWNED_PER_SIDE,
    },
  ],
};
