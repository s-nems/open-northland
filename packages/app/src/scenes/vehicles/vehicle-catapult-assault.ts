import {
  cellAnchorNode,
  components,
  type Entity,
  hexDistanceBetween,
  nodeOfPosition,
  playerCommand,
  type Simulation,
  SUCCESSFUL_IF,
  systems,
} from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_ARCHER, JOB_SOLDIER_SWORD } from '../../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER, PRIMARY_TRIBE } from '../../game/rules.js';
import {
  GATHERERS,
  PALISADE_WALL_GFX_INDEX,
  placeBuiltSandboxBuilding,
  resourceSpecFor,
  spawnSandboxSettlerDirect,
  spawnSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_CATAPULT,
  WEAPON_SHORT_BOW,
  WEAPON_SWORD,
} from '../../game/sandbox/index.js';
import { enemyBuildings } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

/**
 * A battery's attack-move on a defended village: three crewed catapults march on a spot behind the
 * enemy palisade. Swordsmen stand inside their band on the flanks, archers stand farther back and a
 * tower behind the wall, both past the band, with a sparse wood in between. The catapults roll up to the
 * archers, then to the tower, rather than stone the swordsmen in reach, and each fires from a spot of
 * its own, none left standing in a gap between the trees.
 */

const MAP_W = 50;
const MAP_H = 24;

/** Cell positions: each catapult with its commander three cells west. */
const BATTERY: readonly { readonly catapult: [number, number]; readonly commander: [number, number] }[] = [
  { catapult: [5, 7], commander: [2, 7] },
  { catapult: [5, 12], commander: [2, 12] },
  { catapult: [5, 17], commander: [2, 17] },
];
/** A commander this practised never scatters, so every stone lands on its mark. */
const MASTER_CATAPULT_SKILL = 100;
/** On the flanks of the advance, inside the battery's band and clear of its lanes. They hold their ground
 *  and outlast the run, so a battery that shot what it reaches first would never get past them. */
const ENEMY_SWORDSMEN: readonly [number, number][] = [
  [16, 3],
  [16, 21],
];
const SWORDSMAN_HITPOINTS = 10_000_000;
/** About 34 map points east: past the band, inside the reach a shooter draws a catapult from. */
const ENEMY_ARCHERS: readonly [number, number][] = [
  [22, 10],
  [22, 12],
  [22, 14],
];
/** The sparse wood the battery crosses: a tree every {@link WOOD_SPACING} nodes on every other row from
 *  column {@link WOOD_FROM_HX} to {@link WOOD_TO_HX}, each row shifted, so its lanes are gaps a catapult
 *  may pass but not stand in. */
const WOOD_FROM_HX = 26;
const WOOD_TO_HX = 42;
const WOOD_SPACING = 4;
const WOOD_ROW_STEP = 2;
/** The half-cell column of the enemy palisade, open for {@link GATE_HALF_ROWS} rows either side of the
 *  middle so the march has a way through. */
const WALL_HX = 50;
const GATE_HALF_ROWS = 6;
/** Just behind the wall. */
const ENEMY_TOWER: readonly [string, number, number] = ['tower_00', 28, 12];
/** A few stones' worth, so the tower falls inside the run. */
const TOWER_HITPOINTS = 20_000;
/** Behind the wall, past the tower. */
const MARCH_GOAL = { x: 42, y: 12 } as const;
/** After every commander has walked to its door and stepped in. */
const MARCH_ORDER_TICK = 40;
/** Claims a position no session transport hands out for that tick. */
const ORDER_SEQUENCE = 1_000_000;
const CATAPULT_LOGIC_SIZE = 1;
const RUN_TICKS = 1500;
/** Between the battery and the wall, so the browser opens on the whole advance. */
const CAMERA_AT = { hx: 40, hy: 24 } as const;

const { Health, Position, Settler, SettlerProgress, Stance, Owner, Vehicle } = components;

function placeWall(sim: Simulation, hy: number): void {
  const terrain = sim.terrain;
  if (terrain === undefined) throw new Error('vehicle-catapult-assault requires terrain');
  const type = systems.palisadeType(terrain, PALISADE_WALL_GFX_INDEX);
  if (type === undefined) throw new Error('vehicle-catapult-assault: no palisade record');
  systems.createPalisade(sim.world, type, {
    x: WALL_HX,
    y: hy,
    tribe: PRIMARY_TRIBE,
    owner: ENEMY_PLAYER,
    underConstruction: false,
  });
}

function plantWood(sim: Simulation): void {
  const wood = GATHERERS.find((g) => g.id === 'wood');
  if (wood === undefined) throw new Error('vehicle-catapult-assault: no wood gatherer spec');
  for (let hy = WOOD_ROW_STEP, row = 0; hy < 2 * MAP_H - WOOD_ROW_STEP; hy += WOOD_ROW_STEP, row++) {
    const shift = (row * WOOD_ROW_STEP) % WOOD_SPACING;
    for (let hx = WOOD_FROM_HX + shift; hx <= WOOD_TO_HX; hx += WOOD_SPACING) {
      systems.createResourceNode(sim.world, sim.content, resourceSpecFor(wood, hx, hy));
    }
  }
}

function build(sim: Simulation): void {
  for (let hy = 0; hy < 2 * MAP_H; hy++) {
    if (Math.abs(hy - MAP_H) > GATE_HALF_ROWS) placeWall(sim, hy);
  }
  plantWood(sim);
  const goal = cellAnchorNode(MARCH_GOAL.x, MARCH_GOAL.y);
  let sequence = ORDER_SEQUENCE;
  for (const {
    catapult: [cx, cy],
    commander: [mx, my],
  } of BATTERY) {
    const catapult = spawnVehicleDirect(sim, VEHICLE_CATAPULT, cx, cy);
    const commander = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, mx, my);
    sim.world
      .mut(commander, SettlerProgress)
      .experience.set(systems.FIGHT_EXPERIENCE_TYPE.CATAPULT, MASTER_CATAPULT_SKILL);
    sim.enqueue(
      playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity: commander, vehicle: catapult }),
    );
    sim.enqueueAt(
      playerCommand(HUMAN_PLAYER, {
        kind: 'moveVehicle',
        vehicle: catapult,
        x: goal.hx,
        y: goal.hy,
        attackMove: true,
      }),
      MARCH_ORDER_TICK,
      sequence++,
    );
  }
  const tower = placeBuiltSandboxBuilding(sim, ENEMY_TOWER[0], ENEMY_TOWER[1], ENEMY_TOWER[2], ENEMY_PLAYER);
  sim.world.mut(tower, Health).hitpoints = TOWER_HITPOINTS;
  sim.world.mut(tower, Health).max = TOWER_HITPOINTS;
  for (const [x, y] of ENEMY_SWORDSMEN) {
    const swordsman = spawnSandboxSettlerDirect(sim, JOB_SOLDIER_SWORD, x, y, ENEMY_PLAYER, {
      weaponTypeId: WEAPON_SWORD,
      hitpoints: SWORDSMAN_HITPOINTS,
    });
    sim.world.mut(swordsman, Stance).mode = systems.MILITARY_MODE.IGNORE;
  }
  for (const [x, y] of ENEMY_ARCHERS) {
    const archer = spawnSandboxSettlerDirect(sim, JOB_ARCHER, x, y, ENEMY_PLAYER, {
      weaponTypeId: WEAPON_SHORT_BOW,
    });
    sim.world.mut(archer, Stance).mode = systems.MILITARY_MODE.IGNORE;
  }
}

function ownCatapults(sim: Simulation): Entity[] {
  return sim
    .vehiclesOf(HUMAN_PLAYER)
    .filter((v) => v.vehicleType === VEHICLE_CATAPULT)
    .map((v) => v.entity);
}

function livingEnemyArchers(sim: Simulation): number {
  let n = 0;
  for (const e of sim.world.query(Settler, Owner, Health)) {
    if (sim.world.get(e, Owner).player !== ENEMY_PLAYER) continue;
    if (sim.world.get(e, Settler).jobType === JOB_ARCHER && sim.world.get(e, Health).hitpoints > 0) n++;
  }
  return n;
}

export const vehicleCatapultAssaultScene: SceneDefinition = {
  id: 'vehicle-catapult-assault',
  seed: 37,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  missions: {
    missions: [
      {
        active: true,
        visible: false,
        successfullIf: SUCCESSFUL_IF.all,
        goals: [],
        results: [{ opcode: 'SetCameraPosition', point: CAMERA_AT }],
      },
    ],
  },
  runTicks: RUN_TICKS,
  initialZoom: 1,
  checks: [
    {
      label: 'the stones killed the archers behind the line of swordsmen',
      predicate: (sim) => livingEnemyArchers(sim) === 0,
    },
    {
      label: 'the stones razed the tower behind the wall',
      predicate: (sim) => enemyBuildings(sim).length === 0,
    },
    {
      label: 'the whole battery came through and every catapult is firing',
      predicate: (sim) => {
        const battery = ownCatapults(sim);
        return (
          battery.length === BATTERY.length &&
          battery.every((e) => sim.world.get(e, Vehicle).task === 'attacks')
        );
      },
    },
    {
      label: 'the catapults stand apart, none touching another',
      predicate: (sim) => {
        const at = ownCatapults(sim).map((e) => {
          const p = sim.world.get(e, Position);
          return nodeOfPosition(p.x, p.y);
        });
        return at.every((a, i) =>
          at.every((b, j) => i >= j || hexDistanceBetween(a.hx, a.hy, b.hx, b.hy) > 2 * CATAPULT_LOGIC_SIZE),
        );
      },
    },
  ],
};
