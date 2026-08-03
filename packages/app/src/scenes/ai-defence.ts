import { components, type Entity, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_ARCHER, JOB_COLLECTOR, JOB_FARMER, JOB_SOLDIER_SWORD } from '../catalog/jobs.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  BUILDING_WATCHTOWER,
  placeBuiltSandboxBuilding,
  spawnSandboxSettler,
  WEAPON_SWORD,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * The strategic AI defending its own town. The red seat is handed to the AI with only its military module
 * running, so everything a watcher sees is the defence plan and not a build order: it rings the alarm over
 * its headquarters, walls three of its four archers into the watchtower, and throws everyone still free at
 * the warband standing in its fields.
 *
 * Layout: the red town on the left - tower above the headquarters, archers beside the tower, swordsmen and
 * a crowd of colonists below it - and a blue warband within reach of the headquarters from the start, so
 * the first AI decision (tick 1) already sees the raid and a human watching from tick 0 sees the whole
 * reaction play out.
 *
 * Both warbands are over-tough on purpose: the point is the reaction and the end state it settles into, not
 * who wins, and a raid that got cut down would have the AI stand its town back up mid-scene.
 */

const MAP_W = 26;
const MAP_H = 14;

const TOWER = { x: 7, y: 4 } as const;
const HEADQUARTERS = { x: 7, y: 9 } as const;

/** One more archer than the tower takes, so the cap is visible: three go up, the fourth stays in the field
 *  army and answers the raid with the swordsmen. */
const ARCHER_STARTS: readonly (readonly [number, number])[] = [
  [4, 3],
  [4, 5],
  [5, 3],
  [5, 5],
];
const SWORD_STARTS: readonly (readonly [number, number])[] = [
  [5, 10],
  [5, 11],
  [6, 11],
];
/** The town's colonists - on the headquarters' doorstep, so the alarm has them all inside well before the
 *  warband is anywhere near them. */
const COLONIST_JOBS: readonly number[] = [JOB_COLLECTOR, JOB_FARMER];
const COLONIST_STARTS: readonly (readonly [number, number])[] = [
  [9, 8],
  [9, 9],
  [9, 10],
  [10, 9],
];
/** The warband, inside the headquarters' watch band from tick 0 (`military/defence/threat.ts` measures the
 *  house bow's `maximumrange 29` in half-cell nodes - 24 from these tiles to that anchor). */
const RAIDER_STARTS: readonly (readonly [number, number])[] = [
  [18, 8],
  [18, 9],
  [18, 10],
];
/** Over-tough on both sides: nothing falls, so the scene settles into a readable standing fight. */
const FIGHTER_HITPOINTS = 200_000;

/** Past the walk to the wall, the run for cover and the charge out - the state every check reads. */
const RUN_TICKS = 300;

const { Building, DefenceMode, Garrison, JobAssignment, Owner, Position, Resting, Settler, Sheltering } =
  components;

function build(sim: Simulation): void {
  placeBuiltSandboxBuilding(sim, BUILDING_WATCHTOWER, TOWER.x, TOWER.y, ENEMY_PLAYER);
  placeBuiltSandboxBuilding(sim, BUILDING_HEADQUARTERS, HEADQUARTERS.x, HEADQUARTERS.y, ENEMY_PLAYER);
  for (const [x, y] of ARCHER_STARTS) {
    spawnSandboxSettler(sim, JOB_ARCHER, x, y, ENEMY_PLAYER, { hitpoints: FIGHTER_HITPOINTS });
  }
  for (const [x, y] of SWORD_STARTS) {
    spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, x, y, ENEMY_PLAYER, {
      weaponTypeId: WEAPON_SWORD,
      hitpoints: FIGHTER_HITPOINTS,
    });
  }
  COLONIST_STARTS.forEach(([x, y], i) => {
    spawnSandboxSettler(sim, COLONIST_JOBS[i % COLONIST_JOBS.length] ?? JOB_COLLECTOR, x, y, ENEMY_PLAYER);
  });
  for (const [x, y] of RAIDER_STARTS) {
    spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, x, y, HUMAN_PLAYER, {
      weaponTypeId: WEAPON_SWORD,
      hitpoints: FIGHTER_HITPOINTS,
    });
  }
  // Military alone: with the build order and the workforce running too, the seat would spend the scene
  // re-staffing its own town and the defence would be the smaller half of what a watcher sees.
  sim.enqueue({
    kind: 'setPlayerAi',
    player: ENEMY_PLAYER,
    enabled: true,
    modules: {
      collectResources: false,
      guideBuild: false,
      homeExpansion: false,
      houseBuild: false,
      houseUpgrade: false,
      military: true,
      roadBuild: false,
    },
  });
}

function townsfolk(sim: Simulation, of: (jobType: number | null) => boolean): Entity[] {
  return [...sim.world.query(Settler, Owner)].filter(
    (e) => sim.world.get(e, Owner).player === ENEMY_PLAYER && of(sim.world.get(e, Settler).jobType),
  );
}

/** The AI's building of `buildingType` - the scene places exactly one watchtower and one headquarters. */
function ownBuilding(sim: Simulation, buildingType: number): Entity | undefined {
  return [...sim.world.query(Building, Owner)].find(
    (e) =>
      sim.world.get(e, Owner).player === ENEMY_PLAYER &&
      sim.world.get(e, Building).buildingType === buildingType,
  );
}

function standsAt(sim: Simulation, e: Entity, building: Entity): boolean {
  const at = sim.world.get(e, Position);
  const post = sim.world.get(building, Position);
  return at.x === post.x && at.y === post.y;
}

export const aiDefenceScene: SceneDefinition = {
  id: 'ai-defence',
  seed: 5,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: 0.9,
  checks: [
    {
      label: 'the AI rang its own alarm - the headquarters stands in defence mode',
      predicate: (sim) => {
        const hq = ownBuilding(sim, BUILDING_HEADQUARTERS);
        return hq !== undefined && sim.world.has(hq, DefenceMode);
      },
    },
    {
      label: 'three of its four archers hold the watchtower',
      predicate: (sim) => {
        const tower = ownBuilding(sim, BUILDING_WATCHTOWER);
        if (tower === undefined) return false;
        const manning = townsfolk(sim, (job) => job === JOB_ARCHER).filter(
          (e) => sim.world.tryGet(e, Garrison)?.post === tower && standsAt(sim, e, tower),
        );
        return manning.length === systems.TOWER_GARRISON_ARCHERS;
      },
    },
    {
      label: 'the archer it had no room for was left to the field army',
      predicate: (sim) =>
        townsfolk(sim, (job) => job === JOB_ARCHER).filter((e) => !sim.world.has(e, JobAssignment)).length ===
        ARCHER_STARTS.length - systems.TOWER_GARRISON_ARCHERS,
    },
    {
      // They start WEST of the headquarters and the warband stands east of it, so a swordsman past that
      // anchor can only have marched out - no coordinate arithmetic, just two live positions.
      label: 'every soldier it did not wall in went out at the warband',
      predicate: (sim) => {
        const hq = ownBuilding(sim, BUILDING_HEADQUARTERS);
        if (hq === undefined) return false;
        const anchor = sim.world.get(hq, Position).x;
        const free = townsfolk(sim, (job) => job === JOB_SOLDIER_SWORD);
        return (
          free.length === SWORD_STARTS.length && free.every((e) => sim.world.get(e, Position).x > anchor)
        );
      },
    },
    {
      label: 'its colonists are all in cover',
      predicate: (sim) => {
        const colonists = townsfolk(sim, (job) => job !== null && COLONIST_JOBS.includes(job));
        // Claimed AND arrived: `Sheltering` alone is stamped when the drive picks a shelter, so it would
        // pass with the whole town still crossing the field.
        return (
          colonists.length > 0 &&
          colonists.every((e) => {
            const claim = sim.world.tryGet(e, Sheltering)?.shelter;
            return claim !== undefined && sim.world.tryGet(e, Resting)?.at === claim;
          })
        );
      },
    },
  ],
};
