import { type BuildingFootprint, DEFAULT_RECIPE_TICKS } from '@open-northland/data';
import { VIKING_BUILDINGS, type VikingBuilding } from '../../catalog/buildings.js';
import { shelterCapacityFor } from '../../catalog/defence.js';
import { approximateFootprint } from '../../catalog/footprints.js';
import { STORABLE_EXTENDED_GOODS } from '../../catalog/goods.js';
import { JOB_COLLECTOR } from '../../catalog/jobs.js';
import { buildingConstructionCost, buildingHitpoints, buildingUpgradeTarget } from './construction.js';
import type { SandboxContentExtras } from './content/types.js';
import {
  BUILDING_ANIMAL_FARM,
  BUILDING_BAKERY,
  BUILDING_FARM,
  BUILDING_HEADQUARTERS,
  BUILDING_HOME_00,
  BUILDING_JOINERY,
  BUILDING_MILL,
  BUILDING_WAREHOUSE_00,
  BUILDING_WAREHOUSE_01,
  BUILDING_WAREHOUSE_02,
  BUILDING_WATCHTOWER,
  BUILDING_WELL,
  GOOD_BREAD,
  GOOD_CATTLE,
  GOOD_COIN,
  GOOD_FLOUR,
  GOOD_FOOD_EXTRA,
  GOOD_FOOD_SIMPLE,
  GOOD_GOLD,
  GOOD_IRON,
  GOOD_LEATHER,
  GOOD_MEAD,
  GOOD_MEAT,
  GOOD_MUD,
  GOOD_MUSHROOM,
  GOOD_PLANK,
  GOOD_SHEEP,
  GOOD_STONE,
  GOOD_WATER,
  GOOD_WHEAT,
  GOOD_WOOD,
  GOOD_WOOL,
} from './ids/index.js';
import { workerSlotsFor } from './worker-slots.js';

// Extracted `logicstock 4 25 0` on the "work farm 00" block (`DataCnmd/types/houses.ini`).
const FARM_WHEAT_CAPACITY = 25;
// Extracted `logicstock 4 10 1` + `logicstock 11 20 0` on "work mill 00". The trailing logicstock int
// is the consumed-here flag, not an initial fill, so every slot in this file starts empty.
const MILL_WHEAT_CAPACITY = 10;
const MILL_FLOUR_CAPACITY = 20;
// Extracted `logicstock 1 1 0` on the "work well 00" block.
const WELL_WATER_CAPACITY = 1;
// Extracted `logicstock 1 10 1` + `logicstock 11 10 1` + `logicstock 19 20 0` on "work bakery 00".
const BAKERY_WATER_CAPACITY = 10;
const BAKERY_FLOUR_CAPACITY = 10;
const BAKERY_BREAD_CAPACITY = 20;
// Extracted `logicstock` on the "work animal farm" block: water/wheat in, sheep/cattle tokens
// in-house, wool/leather/meat out.
const ANIMAL_FARM_INPUT_CAPACITY = 10;
const ANIMAL_FARM_TOKEN_CAPACITY = 20;
const ANIMAL_FARM_OUTPUT_CAPACITY = 30;

export interface StockSlot {
  readonly goodType: number;
  readonly capacity: number;
  readonly initial: number;
}

/**
 * Dishes a general store must not slot, so each reaches a larder as the `food_simple` a lift out of its
 * own house converts it to (`sim/systems/readviews/food.ts` owns that rule). Extracted basis
 * (`DataCnmd/types/houses.ini`): meat has a `logicstock` line in "work animal farm" alone, bread in
 * "work bakery 00"/"01" alone.
 */
export const DISHES_KEPT_OUT_OF_STORES: readonly number[] = [GOOD_MEAT, GOOD_BREAD];

/** Which goods a general store holds is a sandbox balance pin, not extracted data. */
const STORE_GOODS: readonly number[] = [
  GOOD_WOOD,
  GOOD_PLANK,
  GOOD_COIN,
  GOOD_STONE,
  GOOD_MUD,
  GOOD_IRON,
  GOOD_GOLD,
  GOOD_MUSHROOM,
  ...STORABLE_EXTENDED_GOODS.filter((g) => !DISHES_KEPT_OUT_OF_STORES.includes(g.typeId)).map(
    (g) => g.typeId,
  ),
];

function storeStock(capacity: number): readonly StockSlot[] {
  return STORE_GOODS.map((goodType) => ({ goodType, capacity, initial: 0 }));
}

/** Per-good capacity by warehouse tier: sandbox balance, not extracted (real `logicstock` is 45/70/120). */
const WAREHOUSE_SLOT_CAPACITY = [100, 250, 500] as const;

/** Sandbox balance, not extracted (the real `logicstock` HQ cap is 150). */
const HQ_SLOT_CAPACITY = 500;

export interface SandboxBuildingRow {
  typeId: number;
  id: string;
  kind: string;
  /** How many families, not settlers, a home houses (`logichomesize`). */
  homeSize?: number;
  stock?: readonly StockSlot[];
  construction?: readonly { goodType: number; amount: number }[];
  hitpoints?: number;
  recipes?: readonly {
    inputs: readonly { goodType: number; amount: number }[];
    outputs: readonly { goodType: number; amount: number }[];
    ticks: number;
  }[];
  /** The goods this workplace makes (`logicproduction`); a field-farmed good has no `recipes`. */
  produces?: readonly number[];
  workers?: readonly { jobType: number; count: number }[];
  footprint?: BuildingFootprint;
  upgradeTarget?: number;
  canEnableDefenceMode?: boolean;
  /** How many civilians the building shelters in defence mode. */
  shelterCapacity?: number;
}

/** Extracted `logicstock 16 25` / `43 25` on both tower tiers. */
const TOWER_LARDER_CAPACITY = 25;

/** A `workers` entry here replaces the extracted `BUILDING_WORKER_SLOTS` default. */
const BUILDING_OVERRIDES: Readonly<Record<number, Partial<SandboxBuildingRow>>> = {
  [BUILDING_HEADQUARTERS]: { stock: storeStock(HQ_SLOT_CAPACITY) },
  // Extracted shape ("work well 00"): water-only store, `logicproduction 1`. Water is producedInHouse
  // in `goodtypes.ini`, not map-gathered, hence the input-less recipe.
  [BUILDING_WELL]: {
    stock: [{ goodType: GOOD_WATER, capacity: WELL_WATER_CAPACITY, initial: 0 }],
    produces: [GOOD_WATER],
    recipes: [{ inputs: [], outputs: [{ goodType: GOOD_WATER, amount: 1 }], ticks: DEFAULT_RECIPE_TICKS }],
  },
  // Extracted shape ("work bakery 00"): three-slot store, `logicproduction 19`. The 1 water + 1 flour
  // per bread is a named approximation; `productionInputGoods 11 1` names the inputs, not the amounts.
  [BUILDING_BAKERY]: {
    stock: [
      { goodType: GOOD_WATER, capacity: BAKERY_WATER_CAPACITY, initial: 0 },
      { goodType: GOOD_FLOUR, capacity: BAKERY_FLOUR_CAPACITY, initial: 0 },
      { goodType: GOOD_BREAD, capacity: BAKERY_BREAD_CAPACITY, initial: 0 },
    ],
    produces: [GOOD_BREAD],
    recipes: [
      {
        inputs: [
          { goodType: GOOD_WATER, amount: 1 },
          { goodType: GOOD_FLOUR, amount: 1 },
        ],
        outputs: [{ goodType: GOOD_BREAD, amount: 1 }],
        ticks: DEFAULT_RECIPE_TICKS,
      },
    ],
  },
  // Extracted shape ("work farm 00"): wheat-only store, `logicproduction 4`. No recipe on purpose, the
  // field loop around the building makes the wheat.
  [BUILDING_FARM]: {
    stock: [{ goodType: GOOD_WHEAT, capacity: FARM_WHEAT_CAPACITY, initial: 0 }],
    produces: [GOOD_WHEAT],
  },
  // Extracted shape ("work mill 00"): two-slot store, `logicproduction 11`. The 1:1 wheat-to-flour
  // ratio is a named approximation; `productionInputGoods 4` names the input, not the amount.
  [BUILDING_MILL]: {
    stock: [
      { goodType: GOOD_WHEAT, capacity: MILL_WHEAT_CAPACITY, initial: 0 },
      { goodType: GOOD_FLOUR, capacity: MILL_FLOUR_CAPACITY, initial: 0 },
    ],
    produces: [GOOD_FLOUR],
    recipes: [
      {
        inputs: [{ goodType: GOOD_WHEAT, amount: 1 }],
        outputs: [{ goodType: GOOD_FLOUR, amount: 1 }],
        ticks: DEFAULT_RECIPE_TICKS,
      },
    ],
  },
  // Extracted stock ("tower 00"/"tower 01"): the garrison's own larder, which is what lets a manned
  // post feed itself instead of climbing down.
  [BUILDING_WATCHTOWER]: {
    stock: [
      { goodType: GOOD_FOOD_SIMPLE, capacity: TOWER_LARDER_CAPACITY, initial: 0 },
      { goodType: GOOD_MEAD, capacity: TOWER_LARDER_CAPACITY, initial: 0 },
    ],
  },
  // Extracted shape ("work animal farm"): sheep/cattle are fed-animal goods stocked in-house
  // (`goodtypes.ini` 57/58 at the catalog offset). The input-less meat recipe mirrors the original's
  // slaughter production; `sim/core/content-index/production.ts` decides how it is gated.
  [BUILDING_ANIMAL_FARM]: {
    stock: [
      { goodType: GOOD_WATER, capacity: ANIMAL_FARM_INPUT_CAPACITY, initial: 0 },
      { goodType: GOOD_WHEAT, capacity: ANIMAL_FARM_INPUT_CAPACITY, initial: 0 },
      { goodType: GOOD_SHEEP, capacity: ANIMAL_FARM_TOKEN_CAPACITY, initial: 0 },
      { goodType: GOOD_CATTLE, capacity: ANIMAL_FARM_TOKEN_CAPACITY, initial: 0 },
      { goodType: GOOD_WOOL, capacity: ANIMAL_FARM_OUTPUT_CAPACITY, initial: 0 },
      { goodType: GOOD_LEATHER, capacity: ANIMAL_FARM_OUTPUT_CAPACITY, initial: 0 },
      { goodType: GOOD_MEAT, capacity: ANIMAL_FARM_OUTPUT_CAPACITY, initial: 0 },
    ],
    produces: [GOOD_SHEEP, GOOD_CATTLE, GOOD_WOOL, GOOD_LEATHER, GOOD_MEAT],
    recipes: [
      {
        inputs: [
          { goodType: GOOD_WATER, amount: 1 },
          { goodType: GOOD_WHEAT, amount: 2 },
        ],
        outputs: [{ goodType: GOOD_SHEEP, amount: 1 }],
        ticks: DEFAULT_RECIPE_TICKS,
      },
      {
        inputs: [
          { goodType: GOOD_WATER, amount: 1 },
          { goodType: GOOD_WHEAT, amount: 2 },
        ],
        outputs: [{ goodType: GOOD_CATTLE, amount: 1 }],
        ticks: DEFAULT_RECIPE_TICKS,
      },
      {
        inputs: [{ goodType: GOOD_SHEEP, amount: 1 }],
        outputs: [{ goodType: GOOD_WOOL, amount: 1 }],
        ticks: DEFAULT_RECIPE_TICKS,
      },
      {
        inputs: [{ goodType: GOOD_CATTLE, amount: 1 }],
        outputs: [{ goodType: GOOD_LEATHER, amount: 1 }],
        ticks: DEFAULT_RECIPE_TICKS,
      },
      { inputs: [], outputs: [{ goodType: GOOD_MEAT, amount: 1 }], ticks: DEFAULT_RECIPE_TICKS },
    ],
  },
  [BUILDING_WAREHOUSE_00]: { stock: storeStock(WAREHOUSE_SLOT_CAPACITY[0]) },
  [BUILDING_WAREHOUSE_01]: { stock: storeStock(WAREHOUSE_SLOT_CAPACITY[1]) },
  [BUILDING_WAREHOUSE_02]: { stock: storeStock(WAREHOUSE_SLOT_CAPACITY[2]) },
  [BUILDING_JOINERY]: {
    workers: [{ jobType: JOB_COLLECTOR, count: 1 }],
    stock: storeStock(HQ_SLOT_CAPACITY),
    recipes: [
      {
        inputs: [{ goodType: GOOD_WOOD, amount: 1 }],
        outputs: [{ goodType: GOOD_PLANK, amount: 1 }],
        ticks: DEFAULT_RECIPE_TICKS,
      },
    ],
  },
};

/** Extracted per home tier: `houses.ini` `logichomesize` 1..5 and `logicstock 16/17 <cap> 1`. */
const HOME_TIERS = [
  { homeSize: 1, foodCapacity: 5 },
  { homeSize: 2, foodCapacity: 10 },
  { homeSize: 3, foodCapacity: 15 },
  { homeSize: 4, foodCapacity: 15 },
  { homeSize: 5, foodCapacity: 15 },
] as const;

/** A home's family capacity and the larder only its own residents eat from. */
function homeRow(b: VikingBuilding): Partial<SandboxBuildingRow> {
  const [smallestHome] = HOME_TIERS;
  const index = Math.max(0, Math.min(HOME_TIERS.length - 1, b.typeId - BUILDING_HOME_00));
  const tier = HOME_TIERS[index] ?? smallestHome;
  return {
    homeSize: tier.homeSize,
    stock: [
      { goodType: GOOD_FOOD_SIMPLE, capacity: tier.foodCapacity, initial: 0 },
      { goodType: GOOD_FOOD_EXTRA, capacity: tier.foodCapacity, initial: 0 },
    ],
  };
}

function buildingRow(b: VikingBuilding): SandboxBuildingRow {
  const slots = workerSlotsFor(b.typeId);
  const upgradeTarget = buildingUpgradeTarget(b.typeId);
  return {
    typeId: b.typeId,
    id: b.id,
    kind: b.kind,
    construction: buildingConstructionCost(b),
    hitpoints: buildingHitpoints(b.kind),
    ...(upgradeTarget !== undefined ? { upgradeTarget } : {}),
    ...(b.canEnableDefenceMode ? { canEnableDefenceMode: true, shelterCapacity: shelterCapacityFor(b) } : {}),
    ...(slots !== undefined ? { workers: slots } : {}),
    ...(b.kind === 'home' ? homeRow(b) : {}),
    ...BUILDING_OVERRIDES[b.typeId],
  };
}

export function buildSandboxBuildings(extras: SandboxContentExtras): Map<number, SandboxBuildingRow> {
  // Extracted footprints from live content replace the by-class approximations wholesale, never per row.
  const footprintOf = (typeId: number, kind: string): { footprint?: BuildingFootprint } => {
    const real = extras.buildingFootprints;
    const fp = real !== undefined ? real.get(typeId) : approximateFootprint(kind);
    return fp !== undefined ? { footprint: fp } : {};
  };
  const buildings = new Map<number, SandboxBuildingRow>();
  for (const b of VIKING_BUILDINGS) {
    buildings.set(b.typeId, { ...buildingRow(b), ...footprintOf(b.typeId, b.kind) });
  }
  for (const b of extras.buildings ?? []) {
    if (!buildings.has(b.typeId)) {
      const kind = b.kind ?? 'workplace';
      buildings.set(b.typeId, { typeId: b.typeId, id: b.id, kind, ...footprintOf(b.typeId, kind) });
    }
  }
  return buildings;
}
