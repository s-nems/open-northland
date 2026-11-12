import {
  cellAnchorNode,
  components,
  type Entity,
  playerCommand,
  type Simulation,
  SUCCESSFUL_IF,
  systems,
} from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_ARCHER_LONG, JOB_SOLDIER_SWORD } from '../../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../../game/rules.js';
import {
  spawnSandboxSettlerDirect,
  spawnSettlerDirect,
  spawnVehicleDirect,
  VEHICLE_CATAPULT,
  WEAPON_LONG_BOW,
  weaponEquipmentFor,
} from '../../game/sandbox/index.js';
import { enemyLivingSettlers, goodBySlug } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

/**
 * A catapult against archers: a crewed catapult holds its ground while three enemy longbowmen in chain
 * mail march on it. It stones them as they come into its band and they shoot its hull from theirs. Each
 * takes three stones, and the hull lasts long enough to fell two of them before it breaks.
 */

const MAP_W = 40;
const MAP_H = 20;

const CATAPULT_AT = { x: 8, y: 10 } as const;
/** The commander stands beside the catapult, off its footprint. */
const COMMANDER_AT = { x: 5, y: 10 } as const;
/** A commander this practised never scatters, so every stone lands on its mark. */
const MASTER_CATAPULT_SKILL = 100;
/** About 40 map points east, past every band, two cells apart so one stone strikes one archer. */
const ENEMY_ARCHERS: readonly [number, number][] = [
  [28, 8],
  [29, 10],
  [28, 12],
];
/** Two of the three: the second falls at about tick 765 and the hull breaks at about 940. A hull of the
 *  original's 3000 hitpoints, or bows at their full vehicle damage, breaks at about 715, before it. */
const ARCHERS_FELLED = 2;
const RUN_TICKS = 1000;
/** Between the catapult and the archers' approach, so the browser opens on the whole exchange. */
const CAMERA_AT = { hx: 28, hy: 20 } as const;

/** Resolved by slug: the sandbox and the real content number the armor goods apart. */
const CHAIN_MAIL = 'armor_chain';

const { Health } = components;

function build(sim: Simulation): void {
  const catapult = spawnVehicleDirect(sim, VEHICLE_CATAPULT, CATAPULT_AT.x, CATAPULT_AT.y);
  const commander = spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, COMMANDER_AT.x, COMMANDER_AT.y);
  sim.world
    .mut(commander, components.SettlerProgress)
    .experience.set(systems.FIGHT_EXPERIENCE_TYPE.CATAPULT, MASTER_CATAPULT_SKILL);
  sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity: commander, vehicle: catapult }));
  sim.enqueue(
    playerCommand(HUMAN_PLAYER, { kind: 'setVehicleStance', vehicle: catapult, stance: 'defence' }),
  );
  const target = cellAnchorNode(CATAPULT_AT.x, CATAPULT_AT.y);
  const bow = weaponEquipmentFor(JOB_ARCHER_LONG, sim.content.goods);
  for (const [x, y] of ENEMY_ARCHERS) {
    const archer = spawnSandboxSettlerDirect(sim, JOB_ARCHER_LONG, x, y, ENEMY_PLAYER, {
      weaponTypeId: WEAPON_LONG_BOW,
      equipment: { ...bow, armor: { goodType: goodBySlug(sim, CHAIN_MAIL) } },
    });
    sim.enqueue(
      playerCommand(ENEMY_PLAYER, { kind: 'attackMoveUnit', entity: archer, x: target.hx, y: target.hy }),
    );
  }
}

function ownCatapult(sim: Simulation): Entity | undefined {
  return sim.vehiclesOf(HUMAN_PLAYER).find((v) => v.vehicleType === VEHICLE_CATAPULT)?.entity;
}

export const vehicleCatapultArchersScene: SceneDefinition = {
  id: 'vehicle-catapult-archers',
  seed: 7,
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
      label: 'the arrows wore the catapult hull down',
      predicate: (sim) => {
        const e = ownCatapult(sim);
        const health = e === undefined ? undefined : sim.world.tryGet(e, Health);
        return health === undefined || health.hitpoints < health.max;
      },
    },
    {
      label: 'the stones felled two of the three archers before the hull broke',
      predicate: (sim) => ENEMY_ARCHERS.length - enemyLivingSettlers(sim) >= ARCHERS_FELLED,
    },
  ],
};
