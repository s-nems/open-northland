import type { Entity, Simulation } from '@open-northland/sim';
import { components } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import {
  JOB_ARCHER,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  placeBuiltSandboxBuilding,
  spawnSandboxSettler,
  WEAPON_BROADSWORD,
  WEAPON_SHORT_BOW,
  WEAPON_SPEAR,
  WEAPON_SWORD,
} from '../game/sandbox/index.js';
import { enemyBuildings } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * The siege scene — a viking warband razes an enemy base. It signs off the "warriors attack enemy
 * buildings" slice: a soldier/archer with the ATTACK stance auto-acquires an enemy STRUCTURE (not just an
 * enemy unit), advances on its door, and drains its Health on the weapon's vs-building column until it is
 * razed. It also signs off the auto-focus priority — the warband smashes the HEADQUARTERS and defensive
 * TOWERS (on par with the enemy defenders) before it ever turns on the plain HOMES, which it razes only
 * once no high-value structure or defender remains (the user rule).
 *
 * Layout: a blue warband on the left (sword/broadsword/spear ranks + archers) facing a compact red base —
 * an HQ flanked by two watchtowers, plain homes tucked around them, and a thin picket of defenders. Every
 * building sits inside the warband's sight, so the tier order (units + HQ + towers first, homes last) is
 * what decides the sequence, not distance.
 *
 * Named divergence (like every scene): the headless twin runs the hand-authored sandbox footprints +
 * vs-building damage approximation (`game/sandbox/combat.ts`); the browser feeds the real extracted
 * footprints. Both keep the placements legal and the mechanic identical.
 */

const MAP_W = 30;
const MAP_H = 24;

/** The blue warband: a rank per weapon class down the left edge, six deep. */
const BLUE_RANKS: readonly { job: number; weapon: number; x: number }[] = [
  { job: JOB_SOLDIER_SWORD, weapon: WEAPON_SWORD, x: 4 },
  { job: JOB_SOLDIER_BROADSWORD, weapon: WEAPON_BROADSWORD, x: 3 },
  { job: JOB_SOLDIER_SPEAR, weapon: WEAPON_SPEAR, x: 2 },
  { job: JOB_ARCHER, weapon: WEAPON_SHORT_BOW, x: 1 },
];
const RANK_Y_FIRST = 8;
const RANK_Y_LAST = 15;

/** The red base — an HQ + two towers (the high-value tier), four plain homes (the fallback tier), all in
 *  the warband's sight so priority, not distance, orders the siege. */
const ENEMY_HQ: readonly [string, number, number] = ['headquarters', 15, 11];
const ENEMY_TOWERS: readonly (readonly [string, number, number])[] = [
  ['tower_00', 13, 8],
  ['tower_00', 13, 14],
];
const ENEMY_HOMES: readonly (readonly [string, number, number])[] = [
  ['home_level_00', 19, 8],
  ['home_level_00', 19, 14],
  ['home_level_00', 22, 10],
  ['home_level_00', 22, 12],
];
/** A thin picket of enemy defenders (killed first — units share the high-priority tier with HQ/towers). */
const ENEMY_DEFENDERS: readonly [number, number, number][] = [
  [JOB_SOLDIER_SWORD, 10, 10],
  [JOB_SOLDIER_SWORD, 10, 12],
  [JOB_SOLDIER_SPEAR, 11, 11],
];

const { Building, Health } = components;

function build(sim: Simulation): void {
  for (let y = RANK_Y_FIRST; y <= RANK_Y_LAST; y++) {
    for (const rank of BLUE_RANKS) {
      spawnSandboxSettler(sim, rank.job, rank.x, y, HUMAN_PLAYER, { weaponTypeId: rank.weapon });
    }
  }
  placeBuiltSandboxBuilding(sim, ENEMY_HQ[0], ENEMY_HQ[1], ENEMY_HQ[2], ENEMY_PLAYER);
  for (const [ref, x, y] of ENEMY_TOWERS) placeBuiltSandboxBuilding(sim, ref, x, y, ENEMY_PLAYER);
  for (const [ref, x, y] of ENEMY_HOMES) placeBuiltSandboxBuilding(sim, ref, x, y, ENEMY_PLAYER);
  for (const [job, x, y] of ENEMY_DEFENDERS) {
    spawnSandboxSettler(sim, job, x, y, ENEMY_PLAYER, {
      weaponTypeId: job === JOB_SOLDIER_SPEAR ? WEAPON_SPEAR : WEAPON_SWORD,
    });
  }
}

/** Whether a live enemy building is one of the high-value structures (HQ or a defensive tower). */
function isHighValue(sim: Simulation, e: Entity): boolean {
  const def = sim.content.buildings.find((b) => b.typeId === sim.world.get(e, Building).buildingType);
  return def?.id === 'headquarters' || def?.kind === 'tower';
}

/** Mean remaining HP fraction (0..1) over `buildings`; 1 when the set is empty (nothing damaged). */
function meanHpFraction(sim: Simulation, buildings: readonly Entity[]): number {
  if (buildings.length === 0) return 1;
  let sum = 0;
  for (const e of buildings) {
    const h = sim.world.get(e, Health);
    sum += h.hitpoints / h.max;
  }
  return sum / buildings.length;
}

/** Whether every enemy defender (unit) has fallen — units share the high-priority tier with HQ/towers. */
function enemyDefendersDead(sim: Simulation): boolean {
  for (const e of sim.world.query(components.Settler, components.Owner, components.Health)) {
    if (
      sim.world.get(e, components.Owner).player === ENEMY_PLAYER &&
      sim.world.get(e, components.Health).hitpoints > 0
    ) {
      return false; // a defender still stands
    }
  }
  return true;
}

// runTicks lands in the window (deterministic from the seed) after the warband has razed the HQ + both
// towers and cut down the defenders, but BEFORE it turns on the plain homes — so the end state itself shows
// the auto-focus priority: high-value structures gone, homes still whole. (The browser view keeps running,
// so a human watches the homes fall next; the sim unit test covers that razing directly.)
export const siegeScene: SceneDefinition = {
  id: 'siege',
  seed: 11,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: 760,
  initialZoom: 0.8,
  checks: [
    {
      // The core mechanic — warriors destroy STRUCTURES (here even the 100k-HP HQ), not only units.
      label: 'the enemy HQ and both watchtowers are razed',
      predicate: (sim) => enemyBuildings(sim).filter((e) => isHighValue(sim, e)).length === 0,
    },
    {
      // Auto-focus priority: the high-value tier fell first while the plain homes stand near-untouched.
      label: 'the plain homes are spared while HQ / towers fall first',
      predicate: (sim) => {
        const homes = enemyBuildings(sim).filter((e) => !isHighValue(sim, e));
        return homes.length >= 3 && meanHpFraction(sim, homes) > 0.7;
      },
    },
    {
      label: 'the enemy defenders were cut down',
      predicate: enemyDefendersDead,
    },
  ],
};
