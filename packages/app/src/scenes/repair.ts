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
 * the raided home in the east, where a red raid meets the blue defence, so they mend the quiet home in
 * the west first. Once the raid is beaten and the home has gone unhit for a while, they mend it too.
 * Nobody orders them; every builder must come through alive.
 */

const MAP_W = 36;
const MAP_H = 18;
const QUIET_HOME = { x: 7, y: 8 } as const;
const RAIDED_HOME = { x: 25, y: 8 } as const;
const BUILDERS: readonly (readonly [number, number])[] = [
  [19, 13],
  [20, 13],
  [21, 13],
];
const RAIDERS: readonly (readonly [number, number])[] = [
  [30, 6],
  [30, 7],
  [30, 8],
  [30, 9],
  [30, 10],
  [31, 7],
  [31, 9],
];
const DEFENDERS: readonly (readonly [number, number])[] = [
  [27, 11],
  [28, 11],
  [29, 11],
  [27, 12],
  [28, 12],
  [29, 12],
  [27, 13],
  [28, 13],
  [29, 13],
];
/** The share of its pool each home starts with: a raid's worth of damage. */
const STARTING_HP_PERCENT = 50;
const PERCENT = 100;
/** The fight lasts about 260 ticks and the second home is whole by about tick 3700 in the headless run,
 *  so this leaves slack. */
const RUN_TICKS = 5000;

const { Damaged, Health, Owner, Person, Settler } = components;

function damagedHome(sim: Simulation, x: number, y: number): Entity {
  const home = placeBuiltSandboxBuilding(sim, BUILDING_HOME_00, x, y, HUMAN_PLAYER);
  const health = sim.world.mut(home, Health);
  health.hitpoints = Math.trunc((health.max * STARTING_HP_PERCENT) / PERCENT);
  sim.world.add(home, Damaged, { lastHitTick: 0 });
  return home;
}

function build(sim: Simulation): void {
  damagedHome(sim, QUIET_HOME.x, QUIET_HOME.y);
  damagedHome(sim, RAIDED_HOME.x, RAIDED_HOME.y);
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
      label: 'the raided home is mended once the raid is over',
      predicate: (sim) => mended(sim, homesWestToEast(sim)[1]),
    },
    {
      label: 'every builder came through alive',
      predicate: (sim) => livingOf(sim, HUMAN_PLAYER, JOB_BUILDER) === BUILDERS.length,
    },
  ],
};
