import type { Entity, Simulation } from '@open-northland/sim';
import { components } from '@open-northland/sim';
import { grassTerrain, VIKING } from '../../catalog/buildings.js';
import { BYZANTINE, CIVILIZATIONS, EGYPTIAN, FRANK, SARACEN } from '../../catalog/civilizations.js';
import { shelterCapacityById } from '../../catalog/defence.js';
import { JOB_CIVILIST, JOB_WOMAN } from '../../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../../game/rules.js';
import {
  BUILDING_WAREHOUSE_02,
  placeBuiltSandboxBuilding,
  spawnSandboxSettler,
} from '../../game/sandbox/index.js';
import type { SceneDefinition } from '../types.js';

/** The headless twin's sandbox content arms only the viking towers; the browser's extracted content arms
 *  every nation's. */

const MAP_W = 40;
const MAP_H = 34;

/** The enemy storehouse every tower shoots at, in the middle of the ring. */
const TARGET_AT = { x: 20, y: 16 } as const;
/** Arrows chip a building away; this many hitpoints keep it standing through a long watch. */
const TARGET_HITPOINTS = 10_000_000;

interface TowerSpot {
  readonly tribe: number;
  readonly ref: 'tower_00' | 'tower_01';
  readonly at: { readonly x: number; readonly y: number };
  /** The first cell of the block its townspeople start in, on the side away from the storehouse. */
  readonly crowd: { readonly x: number; readonly y: number };
}

/** One tower of each nation round the storehouse, so each shoots across a different side of its firing
 *  level, plus the viking stone tower, the one upgrade drawn with a body of its own. */
const TOWERS: readonly TowerSpot[] = [
  { tribe: VIKING, ref: 'tower_00', at: { x: 13, y: 6 }, crowd: { x: 11, y: 2 } },
  { tribe: FRANK, ref: 'tower_00', at: { x: 27, y: 6 }, crowd: { x: 25, y: 2 } },
  { tribe: BYZANTINE, ref: 'tower_00', at: { x: 32, y: 16 }, crowd: { x: 35, y: 14 } },
  { tribe: SARACEN, ref: 'tower_00', at: { x: 27, y: 26 }, crowd: { x: 25, y: 29 } },
  { tribe: EGYPTIAN, ref: 'tower_00', at: { x: 13, y: 26 }, crowd: { x: 11, y: 29 } },
  { tribe: VIKING, ref: 'tower_01', at: { x: 8, y: 16 }, crowd: { x: 1, y: 13 } },
];

/** Townspeople stand this many to a row of their block. */
const CROWD_ROW = 5;
const CROWD_JOBS = [JOB_CIVILIST, JOB_WOMAN] as const;

const { Building, DefenceMode, Health, Owner, Resting, Sheltering } = components;

function build(sim: Simulation): void {
  const target = placeBuiltSandboxBuilding(
    sim,
    BUILDING_WAREHOUSE_02,
    TARGET_AT.x,
    TARGET_AT.y,
    ENEMY_PLAYER,
  );
  const health = sim.world.mut(target, Health);
  health.hitpoints = TARGET_HITPOINTS;
  health.max = TARGET_HITPOINTS;
  for (const { tribe, ref, at, crowd } of TOWERS) {
    const tower = placeBuiltSandboxBuilding(sim, ref, at.x, at.y, HUMAN_PLAYER, { tribe });
    for (let i = 0; i < shelterCapacityById(ref); i++) {
      const job = CROWD_JOBS[i % CROWD_JOBS.length] ?? JOB_CIVILIST;
      const x = crowd.x + (i % CROWD_ROW);
      const y = crowd.y + Math.floor(i / CROWD_ROW);
      spawnSandboxSettler(sim, job, x, y, HUMAN_PLAYER, { tribe });
    }
    // Raised at build, so the browser view plays the run to cover from tick 0.
    sim.enqueueSetup({ kind: 'setDefenceMode', building: tower, enabled: true });
  }
}

function alarmedTowers(sim: Simulation): Entity[] {
  const towers: Entity[] = [];
  for (const e of sim.world.query(Building, DefenceMode)) {
    if (sim.world.tryGet(e, Owner)?.player === HUMAN_PLAYER) towers.push(e);
  }
  return towers;
}

/** Counts a settler only once it has arrived, not while it still walks to its claimed shelter. */
function garrisonOf(sim: Simulation, tower: Entity): number {
  let inside = 0;
  for (const e of sim.world.query(Sheltering)) {
    if (sim.world.get(e, Sheltering).shelter === tower && sim.world.tryGet(e, Resting)?.at === tower)
      inside++;
  }
  return inside;
}

/** The garrison `tower`'s type takes, read by its content id as the catalog keys it. */
function capacityOf(sim: Simulation, tower: Entity): number {
  const type = sim.world.get(tower, Building).buildingType;
  const id = sim.content.buildings.find((b) => b.typeId === type)?.id;
  return id === undefined ? 0 : shelterCapacityById(id);
}

function storehouse(sim: Simulation): Entity | undefined {
  for (const e of sim.world.query(Building, Owner)) {
    if (sim.world.get(e, Owner).player === ENEMY_PLAYER) return e;
  }
  return undefined;
}

export const towerDefenceNationsScene: SceneDefinition = {
  id: 'tower-defence-nations',
  seed: 7,
  terrain: grassTerrain(MAP_W, MAP_H),
  graphicTribes: CIVILIZATIONS,
  build,
  runTicks: 900,
  initialZoom: 0.6,
  checks: [
    {
      label: 'every tower fills to its garrison capacity',
      predicate: (sim) => {
        const towers = alarmedTowers(sim);
        return (
          towers.length === TOWERS.length && towers.every((t) => garrisonOf(sim, t) === capacityOf(sim, t))
        );
      },
    },
    {
      label: 'the storehouse in the middle takes arrows from the towers',
      predicate: (sim) => {
        const target = storehouse(sim);
        const health = target === undefined ? undefined : sim.world.tryGet(target, Health);
        return health !== undefined && health.hitpoints < health.max;
      },
    },
  ],
};
