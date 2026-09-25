import type { Entity, Simulation } from '@open-northland/sim';
import { components } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_BUILDER, JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_HOME_00,
  placeBuiltSandboxBuilding,
  spawnSandboxSettler,
  WEAPON_SWORD,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * The repair scene: builders mend damaged homes without walking into a fight. The builders start nearest
 * the embattled home in the east, where a red raid meets the blue defence, so they mend the quiet home in
 * the west first; without the safety gate they would take the nearer one. Once the quiet home is whole
 * they cross to the embattled one, long after the raid is beaten. Nobody orders them.
 *
 * The headless twin stops between the two repairs, so its end state shows the order. The calm period
 * after a blow is proven in the sim's own suite: the raid here fights the defence, not the home.
 */

const MAP_W = 36;
const MAP_H = 18;
const QUIET_HOME = { x: 7, y: 8 } as const;
const EMBATTLED_HOME = { x: 25, y: 8 } as const;
const BUILDERS: readonly (readonly [number, number])[] = [
  [19, 13],
  [20, 13],
  [21, 13],
];
const RAIDERS: readonly (readonly [number, number])[] = [
  [28, 7],
  [28, 9],
  [29, 8],
  [27, 10],
];
const DEFENDERS: readonly (readonly [number, number])[] = [
  [29, 15],
  [30, 15],
  [31, 15],
  [32, 15],
  [29, 16],
  [30, 16],
  [31, 16],
  [32, 16],
  [29, 17],
  [30, 17],
  [31, 17],
  [32, 17],
];
/** The share of its pool each home starts with. */
const STARTING_HP_PERCENT = 90;
const PERCENT = 100;
/** The fight ends by tick 170. The quiet home is whole by tick 620 and the embattled one by 1240; without
 *  the gate the order flips (520 and 1140), so this stop falls between the two repairs either way. */
const RUN_TICKS = 900;

const { Damaged, Health, Owner, Person, Settler } = components;

function damagedHome(sim: Simulation, x: number, y: number): Entity {
  const home = placeBuiltSandboxBuilding(sim, BUILDING_HOME_00, x, y, HUMAN_PLAYER);
  const health = sim.world.mut(home, Health);
  health.hitpoints = Math.trunc((health.max * STARTING_HP_PERCENT) / PERCENT);
  sim.world.add(home, Damaged, { lastHitTick: null });
  return home;
}

function build(sim: Simulation): void {
  damagedHome(sim, QUIET_HOME.x, QUIET_HOME.y);
  damagedHome(sim, EMBATTLED_HOME.x, EMBATTLED_HOME.y);
  for (const [x, y] of BUILDERS) spawnSandboxSettler(sim, JOB_BUILDER, x, y, HUMAN_PLAYER);
  for (const [x, y] of DEFENDERS) {
    spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, x, y, HUMAN_PLAYER, { weaponTypeId: WEAPON_SWORD });
  }
  for (const [x, y] of RAIDERS) {
    spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, x, y, ENEMY_PLAYER, { weaponTypeId: WEAPON_SWORD });
  }
}

/** The scene's two homes, west (the quiet one) first. */
function homesWestToEast(sim: Simulation): Entity[] {
  const { Building, Position } = components;
  const x = (e: Entity): number => sim.world.get(e, Position).x;
  return [...sim.world.query(Building, Health, Position)].sort((a, b) => x(a) - x(b));
}

function mended(sim: Simulation, home: Entity | undefined): boolean {
  if (home === undefined) return false;
  const health = sim.world.get(home, Health);
  return health.hitpoints === health.max && !sim.world.has(home, Damaged);
}

function livingOf(sim: Simulation, player: number, jobType: number): number {
  let living = 0;
  for (const e of sim.world.query(Person, Settler, Owner, Health)) {
    if (sim.world.get(e, Owner).player !== player) continue;
    if (sim.world.get(e, Settler).jobType !== jobType) continue;
    if (sim.world.get(e, Health).hitpoints > 0) living++;
  }
  return living;
}

export const repairScene: SceneDefinition = {
  id: 'repair',
  seed: 12,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.8,
  checks: [
    {
      label: 'the quiet home is mended to its full hitpoints',
      predicate: (sim) => mended(sim, homesWestToEast(sim)[0]),
    },
    {
      label: 'the raid is beaten',
      predicate: (sim) => livingOf(sim, ENEMY_PLAYER, JOB_SOLDIER_SWORD) === 0,
    },
    {
      label: 'the embattled home, though nearer, waits for the quiet one',
      predicate: (sim) => !mended(sim, homesWestToEast(sim)[1]),
    },
    {
      label: 'every builder came through alive',
      predicate: (sim) => livingOf(sim, HUMAN_PLAYER, JOB_BUILDER) === BUILDERS.length,
    },
  ],
};
