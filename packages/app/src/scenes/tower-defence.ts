import type { Entity, Simulation } from '@open-northland/sim';
import { components } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { shelterCapacityById } from '../catalog/defence.js';
import { JOB_COLLECTOR, JOB_FARMER, JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import { placeBuiltSandboxBuilding, spawnSandboxSettler, WEAPON_SWORD } from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * The tower-defence scene - a village raises the alarm as raiders close in. It signs off defence mode:
 * the player's civilians drop their work, split between the two watchtowers by distance and capacity, hide
 * inside them, and shoot the house bow at whatever comes into reach, while the soldiers stay out in the
 * field. The raiders can hit the towers but never the people behind their walls.
 *
 * Layout: two watchtowers with a crowd of civilians between them - more civilians than the pair can hold,
 * so the overflow visibly keeps working - a couple of home guards, and a red warband walking in from the
 * east. The alarm is raised at build, so a human watching from tick 0 sees the whole run: the scatter to
 * cover, the doors swallowing them, arrows leaving the towers, and the raiders falling short.
 *
 * Named divergence (like every scene): the headless twin runs the hand-authored sandbox weapon/footprint
 * approximations, the browser the real extracted ones. Both keep the mechanic identical.
 */

const MAP_W = 34;
const MAP_H = 20;

const WEST_TOWER: readonly [string, number, number] = ['tower_00', 8, 10];
const EAST_TOWER: readonly [string, number, number] = ['tower_00', 20, 10];

/** Civilians of two trades spread between the towers - deliberately more than the pair shelters, so the
 *  overflow is visible outside. Split west/east of the midpoint so the nearest-tower rule is observable. */
const CIVILIAN_JOBS = [JOB_COLLECTOR, JOB_FARMER] as const;
const CIVILIAN_COLUMNS = [6, 7, 9, 10, 12, 14, 18, 19, 21, 22, 23, 24];
const CIVILIAN_ROW_FIRST = 7;
const CIVILIAN_ROW_LAST = 9;

/** Home guards: fighters never shelter, so these stay in the open whatever the alarm says. */
const GUARDS: readonly (readonly [number, number])[] = [
  [14, 12],
  [15, 13],
];

/** The raiders - a warband deep enough that the volley from the towers takes a while to cut it down. */
const RAIDER_COLUMNS = [29, 30, 31, 32];
const RAIDER_ROW_FIRST = 8;
const RAIDER_ROW_LAST = 12;

const { Building, DefenceMode, Health, Owner, Resting, Settler, Sheltering } = components;

function build(sim: Simulation): void {
  const towers = [WEST_TOWER, EAST_TOWER].map(([ref, x, y]) =>
    placeBuiltSandboxBuilding(sim, ref, x, y, HUMAN_PLAYER),
  );
  let i = 0;
  for (let y = CIVILIAN_ROW_FIRST; y <= CIVILIAN_ROW_LAST; y++) {
    for (const x of CIVILIAN_COLUMNS) {
      const job = CIVILIAN_JOBS[i++ % CIVILIAN_JOBS.length] ?? JOB_COLLECTOR;
      spawnSandboxSettler(sim, job, x, y, HUMAN_PLAYER);
    }
  }
  for (const [x, y] of GUARDS) {
    spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, x, y, HUMAN_PLAYER, { weaponTypeId: WEAPON_SWORD });
  }
  for (let y = RAIDER_ROW_FIRST; y <= RAIDER_ROW_LAST; y++) {
    for (const x of RAIDER_COLUMNS) {
      spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, x, y, ENEMY_PLAYER, { weaponTypeId: WEAPON_SWORD });
    }
  }
  // Raised at build, so the browser view plays the scatter to cover from tick 0.
  for (const tower of towers) sim.enqueue({ kind: 'setDefenceMode', building: tower, enabled: true });
}

/** The player's towers standing on alarm, in placement order (west, then east). */
function alarmedTowers(sim: Simulation): Entity[] {
  const towers: Entity[] = [];
  for (const e of sim.world.query(Building, DefenceMode)) {
    if (sim.world.tryGet(e, Owner)?.player === HUMAN_PLAYER) towers.push(e);
  }
  return towers;
}

/** The player's settlers sheltering INSIDE `tower` (claimed and arrived). */
function garrisonOf(sim: Simulation, tower: Entity): Entity[] {
  const inside: Entity[] = [];
  for (const e of sim.world.query(Settler, Sheltering)) {
    if (sim.world.get(e, Sheltering).shelter === tower && sim.world.tryGet(e, Resting)?.at === tower) {
      inside.push(e);
    }
  }
  return inside;
}

function playerSettlers(sim: Simulation): Entity[] {
  const own: Entity[] = [];
  for (const e of sim.world.query(Settler, Owner)) {
    if (sim.world.get(e, Owner).player === HUMAN_PLAYER) own.push(e);
  }
  return own;
}

// runTicks sits well past the walk to cover and into the exchange of fire, so the end state shows both
// halves of the mechanic: full towers and bloodied raiders.
export const towerDefenceScene: SceneDefinition = {
  id: 'tower-defence',
  seed: 7,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: 600,
  initialZoom: 0.8,
  checks: [
    {
      label: 'both watchtowers fill to their garrison capacity',
      predicate: (sim) => {
        const towers = alarmedTowers(sim);
        const capacity = shelterCapacityById('tower_00');
        return towers.length === 2 && towers.every((t) => garrisonOf(sim, t).length === capacity);
      },
    },
    {
      label: 'the civilians the towers could not hold are still outside',
      predicate: (sim) => playerSettlers(sim).some((e) => !sim.world.has(e, Sheltering)),
    },
    {
      label: 'no fighter took cover',
      predicate: (sim) =>
        playerSettlers(sim).every(
          (e) => !sim.world.has(e, Sheltering) || sim.world.get(e, Settler).jobType !== JOB_SOLDIER_SWORD,
        ),
    },
    {
      // Both halves of the fire: the warband is shot down from cover, and nothing shot back at the
      // people behind the walls (a sheltering settler is not a target - `isValidTarget`).
      label: 'the raiders are cut down from cover while the garrison stays untouched',
      predicate: (sim) => {
        const raidersLeft = [...sim.world.query(Settler, Owner, Health)].filter(
          (e) => sim.world.get(e, Owner).player === ENEMY_PLAYER && sim.world.get(e, Health).hitpoints > 0,
        );
        const garrison = alarmedTowers(sim).flatMap((t) => garrisonOf(sim, t));
        const unharmed = garrison.every((e) => {
          const h = sim.world.get(e, Health);
          return h.hitpoints === h.max;
        });
        return raidersLeft.length === 0 && unharmed;
      },
    },
  ],
};
