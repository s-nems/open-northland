import { components, type Entity, type Simulation, systems } from '@open-northland/sim';
import { grassTerrain } from '../../catalog/buildings.js';
import { JOB_ARCHER, JOB_SOLDIER_SPEAR, JOB_SOLDIER_SWORD } from '../../catalog/jobs.js';
import {
  BUILDING_BARRACKS,
  BUILDING_HEADQUARTERS,
  placeBuiltSandboxBuilding,
  placeSandboxBuilding,
  spawnSettlerDirect,
} from '../../game/sandbox/index.js';
import { buildingStock, goodBySlug } from '../sandbox-queries.js';
import type { SceneDefinition } from '../types.js';

const { CoinDrillOrder, Settler, SettlerProgress, setStockAmount } = components;
const FIGHT = systems.FIGHT_EXPERIENCE_TYPE.PERSONAL;
const COIN = 'coin';

const HEADQUARTERS = { x: 6, y: 12 } as const;
const BARRACKS = { x: 14, y: 10 } as const;
const ROW_Y = 6;
const SWORD_X = 10;
const SPEAR_X = 12;
const BOW_X = 16;
/** The spearman starts part-way, so one coin takes him past the limit. */
const SPEAR_START_POINTS = 30;
/** The coins the three need to reach the limit (two, one, two), and one nobody may take. */
const COINS = 6;
const COINS_LEFT = 1;
/** Five repetitions of the 28-tick clip in turn behind one door, the walks there and back, with slack. */
const RUN_TICKS = 900;

function build(sim: Simulation): void {
  placeSandboxBuilding(sim, BUILDING_HEADQUARTERS, HEADQUARTERS.x, HEADQUARTERS.y);
  const barracks = placeBuiltSandboxBuilding(sim, BUILDING_BARRACKS, BARRACKS.x, BARRACKS.y);
  setStockAmount(sim.world, barracks, goodBySlug(sim, COIN), COINS);
  const soldiers = [
    spawnSettlerDirect(sim, JOB_SOLDIER_SWORD, SWORD_X, ROW_Y),
    spawnSettlerDirect(sim, JOB_SOLDIER_SPEAR, SPEAR_X, ROW_Y),
    spawnSettlerDirect(sim, JOB_ARCHER, BOW_X, ROW_Y),
  ];
  const [, spearman] = soldiers;
  if (spearman !== undefined)
    sim.world.mut(spearman, SettlerProgress).experience.set(FIGHT, SPEAR_START_POINTS);
  for (const entity of soldiers) sim.enqueueSetup({ kind: 'orderCoinDrill', entity, house: barracks });
}

/** Query order is spawn order: the swordsman, the spearman, the archer. */
function cast(sim: Simulation): readonly (Entity | undefined)[] {
  return [...sim.world.query(Settler)];
}

function pointsOf(sim: Simulation, e: Entity | undefined): number {
  return e === undefined ? 0 : (sim.world.get(e, SettlerProgress).experience.get(FIGHT) ?? 0);
}

const drilling = (sim: Simulation, e: Entity | undefined): boolean =>
  e !== undefined && sim.world.has(e, CoinDrillOrder);

export const coinDrillScene: SceneDefinition = {
  id: 'coin-drill',
  seed: 31,
  terrain: grassTerrain(24, 16),
  build,
  runTicks: RUN_TICKS,
  checks: [
    {
      label: 'the swordsman drills two coins to the limit and stops there',
      predicate: (sim) => {
        const [sword] = cast(sim);
        return pointsOf(sim, sword) === systems.COIN_DRILL_LIMIT && !drilling(sim, sword);
      },
    },
    {
      label: 'the spearman, part-way already, takes one coin past the limit',
      predicate: (sim) => {
        const [, spear] = cast(sim);
        return pointsOf(sim, spear) > systems.COIN_DRILL_LIMIT && !drilling(sim, spear);
      },
    },
    {
      label: 'the archer drills to the limit too',
      predicate: (sim) => {
        const [, , bow] = cast(sim);
        return pointsOf(sim, bow) === systems.COIN_DRILL_LIMIT && !drilling(sim, bow);
      },
    },
    {
      label: 'and the barracks keeps the coin nobody below the limit was left to take',
      predicate: (sim) => buildingStock(sim, BUILDING_BARRACKS, COIN) === COINS_LEFT,
    },
  ],
};
