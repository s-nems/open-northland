import type { Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import { spawnSandboxSettler, WEAPON_SWORD } from '../game/sandbox/index.js';
import { blueLivingSettlers, enemyLivingSettlers, goodBySlug, yardGood } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

/** The mead count is exact: scene worlds run with needs off and mead restores only hunger and fatigue,
 *  so nobody sips. */

const MAP_W = 20;
const MAP_H = 16;

/** The facing rank columns and the rows they hold, in cells. */
const BLUE_X = 8;
const RED_X = 11;
const ROW_FIRST = 5;
const ROW_LAST = 9;
const PER_SIDE = ROW_LAST - ROW_FIRST + 1;

/** Part-used gear, which the drop rule destroys with its wearer. */
const SHOES_USED_PCT = 50;

/** A floor for the loot checks, not the expected casualty count. */
const MIN_CASUALTIES = 4;

function build(sim: Simulation): void {
  const gear = {
    weapon: { goodType: goodBySlug(sim, 'sword_shord') },
    armor: { goodType: goodBySlug(sim, 'armor_chain') },
    boots: { goodType: goodBySlug(sim, 'shoes'), degreeOfUsePct: SHOES_USED_PCT },
    misc: [{ goodType: goodBySlug(sim, 'mead') }],
  };
  for (let y = ROW_FIRST; y <= ROW_LAST; y++) {
    for (const [x, owner] of [
      [BLUE_X, HUMAN_PLAYER],
      [RED_X, ENEMY_PLAYER],
    ] as const) {
      spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, x, y, owner, {
        weaponTypeId: WEAPON_SWORD,
        equipment: gear,
      });
    }
  }
}

function casualties(sim: Simulation): number {
  return 2 * PER_SIDE - blueLivingSettlers(sim) - enemyLivingSettlers(sim);
}

export const deathLootScene: SceneDefinition = {
  id: 'death-loot',
  seed: 5,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: 400,
  initialZoom: 2.5, // a dropped heap is only a few pixels at the default zoom
  checks: [
    {
      label: 'the two files really fought (enough men fell to loot)',
      predicate: (sim) => casualties(sim) >= MIN_CASUALTIES,
    },
    {
      label: 'every fallen soldier left his sword, his armor and his full mead on the field',
      predicate: (sim) => {
        const fallen = casualties(sim);
        return (
          yardGood(sim, goodBySlug(sim, 'sword_shord')) === fallen &&
          yardGood(sim, goodBySlug(sim, 'armor_chain')) === fallen &&
          yardGood(sim, goodBySlug(sim, 'mead')) === fallen
        );
      },
    },
    {
      label: 'the half-walked shoes went down with their wearers (a store cannot hold a used unit)',
      predicate: (sim) => yardGood(sim, goodBySlug(sim, 'shoes')) === 0,
    },
  ],
};
