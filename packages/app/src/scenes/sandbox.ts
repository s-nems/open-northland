import type { Simulation } from '@open-northland/sim';
import { components, fx } from '@open-northland/sim';
import { grassTerrain, placedBuildingTypes, VIKING_BUILDINGS } from '../catalog/buildings.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import {
  GATHERERS,
  GOOD_WOOD,
  JOB_ARCHER_LONG,
  JOB_COLLECTOR,
  JOB_SOLDIER_SWORD,
  placeFlag,
  placeResourceNode,
  placeSandboxBuilding,
  spawnBoundGatherer,
  spawnSandboxSettler,
  WEAPON_LONG_BOW,
  WEAPON_SWORD,
} from '../game/sandbox/index.js';
import {
  blueLivingSoldiers,
  blueOwnedSettlers,
  countComponent,
  enemyLivingSettlers,
  expectedGatherYield,
  yardGood,
} from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

const { Felling, MineDeposit, Resource, Stump } = components;

/**
 * The current single sandbox scene: one large deterministic map used to inspect global gameplay systems.
 *
 * The scene itself defines only placement: where buildings, resources, blue player units, and hostile units
 * start. It does not own content, build rules, animation bindings, sounds, speed, tool panel, or controls;
 * those are shared by `game/sandbox/`, `entries/scene.ts`, and `entries/map.ts`.
 */

const MAP_W = 96;
const MAP_H = 96;
const INITIAL_ZOOM = 0.5;
// Enough for the slowest lane to finish: clay is 10 units × (6 strikes × 23-tick dig + 2 inter-swing
// 15-tick rests — the breather lands every 2nd swing, never on the unit-completing one) = ~1 700 work
// ticks, plus per-unit pickup + flag round trips — 4200 leaves honest headroom after the
// strikes-per-unit + inter-swing-rest retune (was 3000, sized to the 1-swing-per-unit pace).
const RUN_TICKS = 4200;

const BUILDING_COLUMNS = 7;
const BUILDING_STEP = 6;
const BUILDING_ORIGIN = { x: 8, y: 8 };

const GATHER_Y0 = 54;
const GATHER_STEP = 2;
const GATHER_WORKER_X = 8;
const GATHER_NODE_X = 13;
const GATHER_FLAG_X = 18;

const PLAYER_CLUSTER: ReadonlyArray<{ x: number; y: number; job: number }> = (() => {
  const out: Array<{ x: number; y: number; job: number }> = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5; col++) out.push({ x: 42 + col, y: 56 + row, job: JOB_COLLECTOR });
  }
  return out;
})();

const BLUE_SOLDIER_ROWS = [18, 19, 20, 21] as const;
const RED_SOLDIER_ROWS = [19, 20, 21] as const;
const BLUE_SOLDIER_X = 60;
const RED_SOLDIER_X = 66;
const ARCHER_POSTS = [
  { x: 58, y: 28 },
  { x: 58, y: 30 },
] as const;

function buildingTile(index: number): { x: number; y: number } {
  return {
    x: BUILDING_ORIGIN.x + (index % BUILDING_COLUMNS) * BUILDING_STEP,
    y: BUILDING_ORIGIN.y + Math.floor(index / BUILDING_COLUMNS) * BUILDING_STEP,
  };
}

function buildBuildings(sim: Simulation): void {
  VIKING_BUILDINGS.forEach((b, index) => {
    const { x, y } = buildingTile(index);
    placeSandboxBuilding(sim, b.typeId, x, y, HUMAN_PLAYER);
  });
}

function buildGatheringLanes(sim: Simulation): void {
  GATHERERS.forEach((g, i) => {
    const y = GATHER_Y0 + i * GATHER_STEP;
    // The flag is created first so the gatherer can be bound to it: each gatherer works only the nodes near
    // its own flag, carries only what it dug, and banks its harvest at that flag (see spawnBoundGatherer).
    const flag = placeFlag(sim, GATHER_FLAG_X, y);
    for (let n = 0; n < g.nodes; n++) {
      placeResourceNode(sim, g, GATHER_NODE_X + n, y);
    }
    spawnBoundGatherer(sim, g.job, GATHER_WORKER_X, y, flag);
  });
}

function buildControllableUnits(sim: Simulation): void {
  // The selectable cluster are gatherers too, so each gets its own flag at its spawn tile — without one an
  // unbound gatherer roams the map for the nearest wood. With no resource in its flag radius it simply
  // stands idle by its flag; the player moves that flag onto work with Ctrl+Right-Click (setWorkFlag).
  for (const u of PLAYER_CLUSTER) {
    const flag = placeFlag(sim, u.x, u.y);
    spawnBoundGatherer(sim, u.job, u.x, u.y, flag);
  }
  for (const y of BLUE_SOLDIER_ROWS) {
    spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, BLUE_SOLDIER_X, y, HUMAN_PLAYER, {
      weaponTypeId: WEAPON_SWORD,
    });
  }
  for (const post of ARCHER_POSTS) {
    // The long bow is job 41's weapon (the real viking job split) — job 40 would draw the short-bow
    // body and truncate the 28-frame long-bow draw against job 40's 12-tick animation.
    spawnSandboxSettler(sim, JOB_ARCHER_LONG, post.x, post.y, HUMAN_PLAYER, {
      weaponTypeId: WEAPON_LONG_BOW,
    });
  }
}

function buildEnemies(sim: Simulation): void {
  for (const y of RED_SOLDIER_ROWS) {
    spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, RED_SOLDIER_X, y, ENEMY_PLAYER, {
      weaponTypeId: WEAPON_SWORD,
    });
  }
}

function build(sim: Simulation): void {
  buildBuildings(sim);
  buildGatheringLanes(sim);
  buildControllableUnits(sim);
  buildEnemies(sim);
}

const { Owner, Settler } = components;

function everyNonEnemySettlerIsBlue(sim: Simulation): boolean {
  for (const e of sim.world.query(Settler, Owner)) {
    const owner = sim.world.get(e, Owner).player;
    if (owner !== HUMAN_PLAYER && owner !== ENEMY_PLAYER) return false;
  }
  return true;
}

export const sandboxScene: SceneDefinition = {
  id: 'sandbox',
  seed: 41,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'the global viking building catalog is present on the map',
      predicate: (sim) => placedBuildingTypes(sim).size === VIKING_BUILDINGS.length,
    },
    {
      label: 'all non-enemy owned settlers use the blue human player slot',
      predicate: (sim) => everyNonEnemySettlerIsBlue(sim) && blueOwnedSettlers(sim) > PLAYER_CLUSTER.length,
    },
    {
      label: 'the red hostile squad is defeated and blue soldiers survive',
      predicate: (sim) => enemyLivingSettlers(sim) === 0 && blueLivingSoldiers(sim) > 0,
    },
    {
      label: 'every source node is fully consumed',
      predicate: (sim) => countComponent(sim, Resource) === 0,
    },
    {
      label: 'every felled tree leaves a stump',
      predicate: (sim) => countComponent(sim, Stump) === GATHERERS.find((g) => g.good === GOOD_WOOD)?.nodes,
    },
    {
      label: 'every felling and mine-deposit workflow has completed',
      predicate: (sim) => countComponent(sim, Felling) === 0 && countComponent(sim, MineDeposit) === 0,
    },
    {
      label: 'each gathered good piles WHOLE onto the ground heaps by its flag',
      predicate: (sim) => GATHERERS.every((g) => yardGood(sim, g.good) === expectedGatherYield(g)),
    },
    {
      label: 'the blue soldiers advanced from their start column into combat',
      predicate: (sim) => {
        for (const e of sim.world.query(Settler, Owner)) {
          if (sim.world.get(e, Owner).player !== HUMAN_PLAYER) continue;
          const s = sim.world.get(e, Settler);
          if (s.jobType !== JOB_SOLDIER_SWORD) continue;
          const p = sim.world.get(e, components.Position);
          if (fx.toInt(p.x) > BLUE_SOLDIER_X) return true;
        }
        return false;
      },
    },
  ],
};
