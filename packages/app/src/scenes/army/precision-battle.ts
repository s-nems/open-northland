import { components, type Entity, fx, type Simulation } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SPEAR_WOODEN,
  JOB_SOLDIER_SWORD,
} from '../../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../../game/rules.js';
import { spawnSettlerAtNode } from '../../game/sandbox/index.js';
import { blueLivingSettlers, enemyLivingSettlers, goodBySlug } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

const MAP_W = 128;
const MAP_H = 48;
/** One file per weapon, melee in front: the bows stand behind their own line. */
const WEAPON_FILES = [
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SPEAR_WOODEN,
  JOB_ARCHER,
  JOB_ARCHER_LONG,
];
/** The amulet side is outnumbered 10 to 13 a weapon, the trial of what the precision amulet is worth. */
const PRECISION_PER_WEAPON = 10;
const PLAIN_PER_WEAPON = 13;
/** A small fight of the same odds far east of the battle, out of its sight: one line a side, the
 *  weapons taken in turn. */
const SKIRMISH_PRECISION = 5;
const SKIRMISH_PLAIN = 7;
const FIGHTERS =
  (PRECISION_PER_WEAPON + PLAIN_PER_WEAPON) * WEAPON_FILES.length + SKIRMISH_PRECISION + SKIRMISH_PLAIN;
/** Half-cell nodes: the front files face each other across the gap, each army deepening away from it. */
const PRECISION_FRONT_HX = 46;
const PLAIN_FRONT_HX = 82;
const SKIRMISH_PRECISION_HX = 204;
const SKIRMISH_PLAIN_HX = 224;
const FILE_STEP_HX = 3;
const FIRST_RANK_HY = 30;
const RANK_STEP_HY = 2;
const MIN_CASUALTIES = 20;
const { Equipment, MISC_EQUIP_SLOTS } = components;

interface Marcher {
  readonly entity: Entity;
  readonly x: number;
  readonly y: number;
}

/** One file of plate-armoured fighters at `hx`, a rank per job, each bound for `towardHx` on its own row. */
function file(
  sim: Simulation,
  owner: number,
  hx: number,
  towardHx: number,
  jobs: readonly number[],
  amulet: string | null,
): Marcher[] {
  const whole = fx.fromInt(0);
  const plate = goodBySlug(sim, 'armor_plate');
  return jobs.map((job, rank) => {
    const hy = FIRST_RANK_HY + rank * RANK_STEP_HY;
    const entity = spawnSettlerAtNode(sim, job, { hx, hy }, owner);
    const worn = sim.world.tryGet(entity, Equipment);
    sim.world.add(entity, Equipment, {
      boots: worn?.boots ?? null,
      tool: worn?.tool ?? null,
      weapon: worn?.weapon ?? null,
      armor: { goodType: plate, degreeOfUse: whole },
      misc: Array.from({ length: MISC_EQUIP_SLOTS }, (_, slot) =>
        slot === 0 && amulet !== null ? { goodType: goodBySlug(sim, amulet), degreeOfUse: whole } : null,
      ),
    });
    return { entity, x: towardHx, y: hy };
  });
}

function army(
  sim: Simulation,
  owner: number,
  frontHx: number,
  enemyFrontHx: number,
  perWeapon: number,
  amulet: string | null,
): void {
  // Each army deepens away from the enemy, and each file marches as far past his front as it stands
  // behind its own.
  const depth = frontHx < enemyFrontHx ? -1 : 1;
  const members = WEAPON_FILES.flatMap((job, place) => {
    const offset = depth * place * FILE_STEP_HX;
    const jobs = Array.from({ length: perWeapon }, () => job);
    return file(sim, owner, frontHx + offset, enemyFrontHx - offset, jobs, amulet);
  });
  sim.enqueueSetup({ kind: 'attackMoveUnitGroup', members });
}

function skirmishLine(
  sim: Simulation,
  owner: number,
  hx: number,
  enemyHx: number,
  count: number,
  amulet: string | null,
): void {
  const jobs = Array.from(
    { length: count },
    (_, place) => WEAPON_FILES[place % WEAPON_FILES.length] ?? JOB_SOLDIER_SWORD,
  );
  sim.enqueueSetup({ kind: 'attackMoveUnitGroup', members: file(sim, owner, hx, enemyHx, jobs, amulet) });
}

function build(sim: Simulation): void {
  army(sim, HUMAN_PLAYER, PRECISION_FRONT_HX, PLAIN_FRONT_HX, PRECISION_PER_WEAPON, 'amulet_crithit');
  army(sim, ENEMY_PLAYER, PLAIN_FRONT_HX, PRECISION_FRONT_HX, PLAIN_PER_WEAPON, null);
  skirmishLine(
    sim,
    HUMAN_PLAYER,
    SKIRMISH_PRECISION_HX,
    SKIRMISH_PLAIN_HX,
    SKIRMISH_PRECISION,
    'amulet_crithit',
  );
  skirmishLine(sim, ENEMY_PLAYER, SKIRMISH_PLAIN_HX, SKIRMISH_PRECISION_HX, SKIRMISH_PLAIN, null);
}

export const precisionBattleScene: SceneDefinition = {
  id: 'precision-battle',
  seed: 31,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: 400,
  initialZoom: 0.7,
  checks: [
    {
      label: 'the armies meet and the fight takes casualties',
      predicate: (sim) => FIGHTERS - blueLivingSettlers(sim) - enemyLivingSettlers(sim) >= MIN_CASUALTIES,
    },
  ],
};
