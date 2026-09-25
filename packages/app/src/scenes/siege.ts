import { BUILDING_KIND } from '@open-northland/data';
import type { Entity, Simulation } from '@open-northland/sim';
import { components, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_ARCHER, JOB_SOLDIER_BROADSWORD, JOB_SOLDIER_SPEAR, JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import {
  placeBuiltSandboxBuilding,
  placeSandboxSite,
  spawnSandboxSettler,
  spawnSettlerDirect,
  WEAPON_BROADSWORD,
  WEAPON_SHORT_BOW,
  WEAPON_SPEAR,
  WEAPON_SWORD,
} from '../game/sandbox/index.js';
import { computeLifeHearts, WOUNDED_LIFE_FRACTION } from '../view/projections/life-hearts.js';
import { enemyBuildings } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/**
 * The siege scene: a viking warband razes an enemy base. It signs off that a warrior in the attack
 * stance auto-acquires an enemy structure, advances on the nearest wall face, and drains its health on
 * the weapon's vs-building column, and that auto-focus takes the headquarters, the towers and the
 * defenders before the plain homes. A foundation stands at one hitpoint, so the first blow flattens the
 * unfinished third tower.
 *
 * It is also the life-heart scene: a human judges that a heart floats over exactly the hurt bodies and
 * that each wears its own faction's colour. The headless twin checks only the settled end state.
 *
 * Named divergence: the headless twin runs the hand-authored sandbox footprints and the vs-building
 * damage approximation; the browser feeds the real extracted footprints.
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

/** The red base sits entirely inside the warband's sight, so priority, not distance, orders the siege. */
const ENEMY_HQ: readonly [string, number, number] = ['headquarters', 15, 11];
const ENEMY_TOWERS: readonly (readonly [string, number, number])[] = [
  ['tower_00', 13, 8],
  ['tower_00', 13, 14],
];
/** Still a foundation, in the warband's path: a tower ranks high-value however far it has risen. */
const ENEMY_TOWER_SITE: readonly [string, number, number] = ['tower_00', 10, 7];
const ENEMY_HOMES: readonly (readonly [string, number, number])[] = [
  ['home_level_00', 19, 8],
  ['home_level_00', 19, 14],
  ['home_level_00', 22, 10],
  ['home_level_00', 22, 12],
];
/** Units share the high-priority tier with the HQ and towers, so this picket falls first. */
const ENEMY_DEFENDERS: readonly [number, number, number][] = [
  [JOB_SOLDIER_SWORD, 10, 10],
  [JOB_SOLDIER_SWORD, 10, 12],
  [JOB_SOLDIER_SPEAR, 11, 11],
];

/** The reserve's wound: deep enough that healing a hitpoint a tick leaves it wounded past `runTicks`. */
const RESERVE_LIFE_FRACTION = 0.5;

const { Building, Health } = components;

function build(sim: Simulation): void {
  for (let y = RANK_Y_FIRST; y <= RANK_Y_LAST; y++) {
    for (const rank of BLUE_RANKS) {
      spawnSandboxSettler(sim, rank.job, rank.x, y, HUMAN_PLAYER, { weaponTypeId: rank.weapon });
    }
  }
  placeBuiltSandboxBuilding(sim, ENEMY_HQ[0], ENEMY_HQ[1], ENEMY_HQ[2], ENEMY_PLAYER);
  for (const [ref, x, y] of ENEMY_TOWERS) placeBuiltSandboxBuilding(sim, ref, x, y, ENEMY_PLAYER);
  placeSandboxSite(sim, ENEMY_TOWER_SITE[0], ENEMY_TOWER_SITE[1], ENEMY_TOWER_SITE[2], ENEMY_PLAYER);
  for (const [ref, x, y] of ENEMY_HOMES) placeBuiltSandboxBuilding(sim, ref, x, y, ENEMY_PLAYER);
  for (const [job, x, y] of ENEMY_DEFENDERS) {
    spawnSandboxSettler(sim, job, x, y, ENEMY_PLAYER, {
      weaponTypeId: job === JOB_SOLDIER_SPEAR ? WEAPON_SPEAR : WEAPON_SWORD,
    });
  }
  // Keep the heart example independent of which front-line warrior survives the fight wounded.
  const reserve = spawnSettlerDirect(sim, JOB_ARCHER, 1, 17, HUMAN_PLAYER);
  const health = sim.world.mut(reserve, Health);
  health.hitpoints = Math.trunc(health.max * RESERVE_LIFE_FRACTION);
  sim.world.mut(reserve, components.Stance).mode = systems.MILITARY_MODE.IGNORE;
}

/** Keyed on the same id and kind as the sim's siege-priority policy, so the check moves with the rule. */
function isHighValue(sim: Simulation, e: Entity): boolean {
  const def = sim.content.buildings.find((b) => b.typeId === sim.world.get(e, Building).buildingType);
  return def?.id === systems.HEADQUARTERS_BUILDING_ID || def?.kind === BUILDING_KIND.tower;
}

/** Mean remaining HP fraction over `buildings`; 1 when the set is empty. */
function meanHpFraction(sim: Simulation, buildings: readonly Entity[]): number {
  if (buildings.length === 0) return 1;
  let sum = 0;
  for (const e of buildings) {
    const h = sim.world.get(e, Health);
    sum += h.hitpoints / h.max;
  }
  return sum / buildings.length;
}

function enemyDefendersDead(sim: Simulation): boolean {
  for (const e of sim.world.query(components.Settler, components.Owner, components.Health)) {
    if (
      sim.world.get(e, components.Owner).player === ENEMY_PLAYER &&
      sim.world.get(e, components.Health).hitpoints > 0
    ) {
      return false;
    }
  }
  return true;
}

// `runTicks` must land after the high-value tier is razed but before the warband turns on the plain
// homes, so the end state itself shows the auto-focus priority. All checks hold at ticks 655..875 in the
// headless fixture, sampled every 5 ticks; leave margin on both sides.
export const siegeScene: SceneDefinition = {
  id: 'siege',
  seed: 11,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: 725,
  initialZoom: 0.8,
  checks: [
    {
      label: 'the enemy HQ, both watchtowers and the tower foundation are razed',
      predicate: (sim) => enemyBuildings(sim).filter((e) => isHighValue(sim, e)).length === 0,
    },
    {
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
    {
      label: 'exactly the wounded warriors wear a life heart',
      predicate: (sim) => {
        const wounded = new Set<number>();
        let unhurt = 0;
        for (const e of sim.world.query(components.Settler, components.Owner, Health)) {
          const h = sim.world.get(e, Health);
          if (h.hitpoints / h.max <= WOUNDED_LIFE_FRACTION) wounded.add(e);
          else unhurt++;
        }
        // No animal on this field and no warrior enters a building, so every heart the projection
        // returns belongs to a warrior.
        const hearts = computeLifeHearts(sim.snapshot(), { isLivestockTribe: () => false });
        return (
          wounded.size > 0 &&
          unhurt > 0 &&
          hearts.length === wounded.size &&
          hearts.every((heart) => wounded.has(heart.id))
        );
      },
    },
  ],
};
