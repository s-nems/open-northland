import type { Simulation } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { STORABLE_EXTENDED_GOODS } from '../catalog/goods.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_WAREHOUSE_02,
  buildingDef,
  DISHES_KEPT_OUT_OF_STORES,
  dropSandboxGood,
  GOOD_COIN,
  GOOD_GOLD,
  GOOD_IRON,
  GOOD_MUD,
  GOOD_MUSHROOM,
  GOOD_PLANK,
  GOOD_STONE,
  GOOD_WOOD,
  placeSandboxBuilding,
} from '../game/sandbox/index.js';
import { countGroundPiles } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 44;
const MAP_H = 40;
const INITIAL_ZOOM = 0.6;
/** No settlers, so nothing hauls and the piles are static from tick 1. */
const RUN_TICKS = 60;

/** A lower bound only the full original catalog clears, not the sandbox core alone. */
const MIN_CATALOG_GOODS = 60;

/** A level-2 store, which accepts every storable good. */
const WAREHOUSE_TILE = { x: 6, y: 5 };

const CORE_STORABLE_GOODS = [
  GOOD_WOOD,
  GOOD_PLANK,
  GOOD_COIN,
  GOOD_STONE,
  GOOD_MUD,
  GOOD_IRON,
  GOOD_GOLD,
  GOOD_MUSHROOM,
] as const;
const DROP_GOODS: readonly number[] = [
  ...CORE_STORABLE_GOODS,
  ...STORABLE_EXTENDED_GOODS.map((g) => g.typeId),
];

const GRID_ORIGIN = { x: 4, y: 12 };
const GRID_COLUMNS = 8;
const GRID_STEP = 3;
/** Varies the per-pile amount 1..5, since the pile graphic grows with its fill. */
const AMOUNT_CYCLE = 5;

function dropTile(index: number): { x: number; y: number } {
  return {
    x: GRID_ORIGIN.x + (index % GRID_COLUMNS) * GRID_STEP,
    y: GRID_ORIGIN.y + Math.floor(index / GRID_COLUMNS) * GRID_STEP,
  };
}

function build(sim: Simulation): void {
  placeSandboxBuilding(sim, BUILDING_WAREHOUSE_02, WAREHOUSE_TILE.x, WAREHOUSE_TILE.y, HUMAN_PLAYER);
  DROP_GOODS.forEach((good, index) => {
    const { x, y } = dropTile(index);
    dropSandboxGood(sim, good, x, y, (index % AMOUNT_CYCLE) + 1);
  });
}

function warehouseStockGoods(sim: Simulation): Set<number> {
  const def = buildingDef(sim, BUILDING_WAREHOUSE_02);
  return new Set((def?.stock ?? []).map((s) => s.goodType));
}

const REPRESENTATIVE_EXTENDED_IDS = ['leather', 'bread', 'mead', 'armor_plate', 'sword_long'] as const;

export const goodsCatalogScene: SceneDefinition = {
  id: 'goods-catalog',
  seed: 1,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'the full goods catalog is globally available (core economy + the extended catalog)',
      predicate: (sim) => {
        const ids = new Set(sim.content.goods.map((g) => g.id));
        return (
          sim.content.goods.length >= MIN_CATALOG_GOODS &&
          REPRESENTATIVE_EXTENDED_IDS.every((id) => ids.has(id))
        );
      },
    },
    {
      label: 'every storable good rests on the ground as its own loose pile',
      predicate: (sim) => countGroundPiles(sim) === DROP_GOODS.length,
    },
    {
      label: 'the warehouse advertises a stock slot for every dropped good but the house-only dishes',
      predicate: (sim) => {
        const stock = warehouseStockGoods(sim);
        return DROP_GOODS.every((good) =>
          DISHES_KEPT_OUT_OF_STORES.includes(good) ? !stock.has(good) : stock.has(good),
        );
      },
    },
  ],
};
