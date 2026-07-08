import type { Simulation } from '@vinland/sim';
import { components, fx } from '@vinland/sim';
import { VIKING_BUILDINGS, grassTerrain, placedBuildingTypes } from '../catalog/buildings.js';
import { ENEMY_PLAYER, HUMAN_PLAYER } from '../game/rules.js';
import {
  GATHERERS,
  GOOD_WOOD,
  JOB_ARCHER,
  JOB_GATHERER_WOOD,
  JOB_SOLDIER_SWORD,
  WEAPON_LONG_BOW,
  WEAPON_SWORD,
  placeDeposit,
  placeFlag,
  placePickNode,
  placeSandboxBuilding,
  placeTree,
  spawnSandboxSettler,
} from '../game/sandbox/index.js';
import {
  blueLivingSoldiers,
  blueOwnedSettlers,
  countComponent,
  enemyLivingSettlers,
  expectedGatherYield,
  flagGood,
} from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

const { Felling, MineDeposit, Resource, Stump } = components;

/**
 * The current single sandbox scene: one large deterministic map used to inspect global gameplay systems.
 *
 * The scene itself defines only placement: where buildings, resources, blue player units, and hostile units
 * start. It does not own content, build rules, animation bindings, sounds, speed, tool panel, or controls;
 * those are shared by `game/sandbox-content.ts`, `entries/scene.ts`, and `entries/live.ts`.
 */

const MAP_W = 96;
const MAP_H = 96;
const INITIAL_ZOOM = 0.5;
const RUN_TICKS = 3000;

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
    for (let col = 0; col < 5; col++) out.push({ x: 42 + col, y: 56 + row, job: JOB_GATHERER_WOOD });
  }
  return out;
})();

const BLUE_SOLDIER_ROWS = [18, 19, 20, 21] as const;
const RED_SOLDIER_ROWS = [19, 20, 21] as const;
const BLUE_SOLDIER_X = 60;
const RED_SOLDIER_X = 66;
const BLUE_HP = 320;
const RED_HP = 170;

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

export function gatherFlagCell(index: number): { x: number; y: number } {
  return { x: GATHER_FLAG_X, y: GATHER_Y0 + index * GATHER_STEP };
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
    spawnSandboxSettler(sim, g.job, GATHER_WORKER_X, y, HUMAN_PLAYER);
    for (let n = 0; n < g.nodes; n++) {
      const x = GATHER_NODE_X + n;
      if (g.mode === 'fell') placeTree(sim, x, y);
      else if (g.mode === 'mine') placeDeposit(sim, g, x, y);
      else placePickNode(sim, g, x, y);
    }
    placeFlag(sim, GATHER_FLAG_X, y);
  });
}

function buildControllableUnits(sim: Simulation): void {
  for (const u of PLAYER_CLUSTER) spawnSandboxSettler(sim, u.job, u.x, u.y, HUMAN_PLAYER);
  for (const y of BLUE_SOLDIER_ROWS) {
    spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, BLUE_SOLDIER_X, y, HUMAN_PLAYER, {
      hitpoints: BLUE_HP,
      weaponTypeId: WEAPON_SWORD,
    });
  }
  for (const post of ARCHER_POSTS) {
    spawnSandboxSettler(sim, JOB_ARCHER, post.x, post.y, HUMAN_PLAYER, {
      hitpoints: BLUE_HP,
      weaponTypeId: WEAPON_LONG_BOW,
    });
  }
}

function buildEnemies(sim: Simulation): void {
  for (const y of RED_SOLDIER_ROWS) {
    spawnSandboxSettler(sim, JOB_SOLDIER_SWORD, RED_SOLDIER_X, y, ENEMY_PLAYER, {
      hitpoints: RED_HP,
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
  title: 'Duza scena testowa',
  summary:
    'Jedna duza mapa testowa: wszystkie budynki wikingow, lanes zbierania surowcow, niebieskie jednostki ' +
    'gracza do zaznaczania/rozkazow oraz czerwony wrogi oddzial. Zasady, animacje, dzwieki, menu budowy, ' +
    'predkosc gry i sterowanie sa globalne, nie scenowe.',
  seed: 41,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checklist: [
    'Lewy panel, predkosc gry, dzwiek i kontrola jednostek dzialaja tutaj tak samo jak w trybie live',
    'Menu budowy pokazuje globalna liste budynkow, a nie liste wymyslona przez scene',
    'Niebieskie jednostki daja sie zaznaczac i rozkazywac; czerwone jednostki sa wrogie i nie daja sie kontrolowac',
    'Wszystkie budynki stoja na jednej mapie i kazdy rysuje wlasny sprite',
    'Zbieracze pracuja roznymi animacjami i skladaja surowce na flagach',
    'Czerwony oddzial walczy z niebieskim, bo wrogosc wynika z gracza/koloru, nie z lokalnej sceny',
  ],
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
      label: 'each gathered good reaches its own flag whole',
      predicate: (sim) =>
        GATHERERS.every((g, i) => flagGood(sim, gatherFlagCell(i), g.good) === expectedGatherYield(g)),
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
