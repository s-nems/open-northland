import { type BuildingFootprint, DEFAULT_RECIPE_TICKS, type PrayerSite } from '@open-northland/data';
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
  BUILDING_CATAPULT_YARD,
  BUILDING_DRUID_HUT,
  BUILDING_DRUID_HUT_01,
  BUILDING_FARM,
  BUILDING_HANDCART_YARD,
  BUILDING_HEADQUARTERS,
  BUILDING_HOME_00,
  BUILDING_JOINERY,
  BUILDING_JOINERY_01,
  BUILDING_JOINERY_02,
  BUILDING_JOINERY_03,
  BUILDING_MILL,
  BUILDING_POTTERY,
  BUILDING_POTTERY_01,
  BUILDING_SHIP_SMALL_YARD,
  BUILDING_WAREHOUSE_00,
  BUILDING_WAREHOUSE_01,
  BUILDING_WAREHOUSE_02,
  BUILDING_WATCHTOWER,
  BUILDING_WELL,
  GOOD_BREAD,
  GOOD_BRICK,
  GOOD_CATAPULT,
  GOOD_CATTLE,
  GOOD_COIN,
  GOOD_CROCKERY,
  GOOD_FLOUR,
  GOOD_FOOD_EXTRA,
  GOOD_FOOD_SIMPLE,
  GOOD_FURNITURE,
  GOOD_GOLD,
  GOOD_HANDCART,
  GOOD_HERB,
  GOOD_HOLY_OIL,
  GOOD_IRON,
  GOOD_LEATHER,
  GOOD_MEAD,
  GOOD_MEAT,
  GOOD_MUD,
  GOOD_MUSHROOM,
  GOOD_PLANK,
  GOOD_POTION_FOOD_BIG,
  GOOD_POTION_FOOD_SMALL,
  GOOD_POTION_HEAL_BIG,
  GOOD_POTION_HEAL_SMALL,
  GOOD_POTION_STAMINA_BIG,
  GOOD_POTION_STAMINA_SMALL,
  GOOD_SHEEP,
  GOOD_SHIP_SMALL,
  GOOD_STONE,
  GOOD_TILE,
  GOOD_TOOL_IRON,
  GOOD_TOOL_WOODEN,
  GOOD_WATER,
  GOOD_WHEAT,
  GOOD_WOOD,
  GOOD_WOOL,
  VEHICLE_CATAPULT,
  VEHICLE_HANDCART,
  VEHICLE_SHIP_SMALL,
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
// Extracted `logicstock` on "work druid 00"/"01": mushrooms and the level-2 potion ingredients in, oil and
// potions out.
const DRUID_INPUT_CAPACITY = 10;
const DRUID_HUT_OIL_CAPACITY = 15;
const DRUID_HUT_01_OUTPUT_CAPACITY = 25;
const CRAFT_INPUT_CAPACITY = 10;
// Extracted `logicstock` on "work joinery 02": the cart slot is declared and never filled, since a
// vehicle good is built on a yard, not shelved.
const JOINERY_CART_CAPACITY = 20;
// Extracted bills of the vehicle yards (houses 42/44/46): the handcart's 2 wood, the small ship's
// 5 leather and 10 wood, the catapult's 9 wood and 1 iron; the footprints are the real ones.
const HANDCART_YARD_WOOD = 2;
const SHIP_YARD_LEATHER = 5;
const SHIP_YARD_WOOD = 10;
const CATAPULT_YARD_WOOD = 9;
const CATAPULT_YARD_IRON = 1;
/** Extracted `logicstock` caps of the level-4 joinery: 20 per input and vehicle good, 15 leather. */
const JOINERY_03_INPUT_CAPACITY = 20;
const JOINERY_03_LEATHER_CAPACITY = 15;

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
  schoolSize?: number;
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
  buildOnBioPattern?: boolean;
  collectAtomic?: number;
  refillsOwnStock?: boolean;
  prayerSite?: PrayerSite;
  canEnableDefenceMode?: boolean;
  /** How many civilians the building shelters in defence mode. */
  shelterCapacity?: number;
  /** The vehicle a finished site of this `vehicle`-kind house spawns. */
  vehicleType?: number;
  /** A ship yard (`logicignorecontinentsflag`): its site lies on the water beside the shipyard. */
  ignoreContinents?: boolean;
}

/** Extracted `logicstock 16 25` / `43 25` on both tower tiers. */
const TOWER_LARDER_CAPACITY = 25;

type SandboxRecipe = NonNullable<SandboxBuildingRow['recipes']>[number];

function holyOilRecipe(): SandboxRecipe {
  return {
    inputs: [{ goodType: GOOD_MUSHROOM, amount: 1 }],
    outputs: [{ goodType: GOOD_HOLY_OIL, amount: 1 }],
    ticks: DEFAULT_RECIPE_TICKS,
  };
}

/** The level-2 hut's bottles, each with how many of every ingredient it costs: a small bottle one, a big
 *  bottle two. */
const POTIONS: readonly (readonly [ingredientAmount: number, goodType: number])[] = [
  [1, GOOD_POTION_FOOD_SMALL],
  [2, GOOD_POTION_FOOD_BIG],
  [1, GOOD_POTION_STAMINA_SMALL],
  [2, GOOD_POTION_STAMINA_BIG],
  [1, GOOD_POTION_HEAL_SMALL],
  [2, GOOD_POTION_HEAL_BIG],
];

function potionRecipe(goodType: number, ingredientAmount: number): SandboxRecipe {
  return {
    inputs: [GOOD_WATER, GOOD_MUSHROOM, GOOD_HERB, GOOD_COIN].map((input) => ({
      goodType: input,
      amount: ingredientAmount,
    })),
    outputs: [{ goodType, amount: 1 }],
    ticks: DEFAULT_RECIPE_TICKS,
  };
}

function potteryRecipe(output: number, mud: number, wood: number): SandboxRecipe {
  return {
    inputs: [
      { goodType: GOOD_MUD, amount: mud },
      { goodType: GOOD_WOOD, amount: wood },
    ],
    outputs: [{ goodType: output, amount: 1 }],
    ticks: DEFAULT_RECIPE_TICKS,
  };
}

function joineryUpgrade(outputCapacity: number, inputCapacity: number): Partial<SandboxBuildingRow> {
  return {
    stock: [
      { goodType: GOOD_WOOD, capacity: inputCapacity, initial: 0 },
      { goodType: GOOD_IRON, capacity: inputCapacity, initial: 0 },
      { goodType: GOOD_TOOL_WOODEN, capacity: outputCapacity, initial: 0 },
      { goodType: GOOD_TOOL_IRON, capacity: outputCapacity, initial: 0 },
      { goodType: GOOD_FURNITURE, capacity: outputCapacity, initial: 0 },
    ],
    produces: [GOOD_TOOL_WOODEN, GOOD_TOOL_IRON, GOOD_FURNITURE],
    recipes: [
      {
        inputs: [{ goodType: GOOD_WOOD, amount: 1 }],
        outputs: [{ goodType: GOOD_TOOL_WOODEN, amount: 1 }],
        ticks: DEFAULT_RECIPE_TICKS,
      },
      {
        inputs: [
          { goodType: GOOD_WOOD, amount: 1 },
          { goodType: GOOD_IRON, amount: 1 },
        ],
        outputs: [{ goodType: GOOD_TOOL_IRON, amount: 1 }],
        ticks: DEFAULT_RECIPE_TICKS,
      },
      {
        inputs: [{ goodType: GOOD_WOOD, amount: 2 }],
        outputs: [{ goodType: GOOD_FURNITURE, amount: 1 }],
        ticks: DEFAULT_RECIPE_TICKS,
      },
    ],
  };
}

/** A joinery row that also raises `vehicles` on yards: each vehicle good gets its never-filled stock slot
 *  and a {@link vehicleTurn}, beside any `extraStock` its yards' bills draw on. */
function withVehicleTurns(
  row: Partial<SandboxBuildingRow>,
  vehicles: readonly number[],
  extraStock: readonly StockSlot[] = [],
): Partial<SandboxBuildingRow> {
  return {
    ...row,
    stock: [
      ...(row.stock ?? []),
      ...extraStock,
      ...vehicles.map((goodType) => ({ goodType, capacity: JOINERY_CART_CAPACITY, initial: 0 })),
    ],
    produces: [...(row.produces ?? []), ...vehicles],
    recipes: [...(row.recipes ?? []), ...vehicles.map(vehicleTurn)],
  };
}

/** A `workers` entry here replaces the extracted `BUILDING_WORKER_SLOTS` default. */
const BUILDING_OVERRIDES: Readonly<Record<number, Partial<SandboxBuildingRow>>> = {
  [BUILDING_HEADQUARTERS]: { stock: storeStock(HQ_SLOT_CAPACITY) },
  // Extracted shape ("work well 00"): water-only store, `logicproduction 1`, refilled by the well itself.
  [BUILDING_WELL]: {
    stock: [{ goodType: GOOD_WATER, capacity: WELL_WATER_CAPACITY, initial: 0 }],
    produces: [GOOD_WATER],
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
      {
        goodType: GOOD_FOOD_SIMPLE,
        capacity: TOWER_LARDER_CAPACITY,
        initial: 0,
      },
      { goodType: GOOD_MEAD, capacity: TOWER_LARDER_CAPACITY, initial: 0 },
    ],
  },
  // Extracted shape ("work animal farm"): the sheep and cattle rows count the herd attached to the farm
  // (`goodtypes.ini` 57/58 at the catalog offset, capacity 20 each), and the two recipes are the
  // breeding the house's own trade enables. Wool, leather and meat arrive off the breeder's slaughter
  // clip, which is why they are stocked but never produced by a recipe.
  [BUILDING_ANIMAL_FARM]: {
    stock: [
      {
        goodType: GOOD_WATER,
        capacity: ANIMAL_FARM_INPUT_CAPACITY,
        initial: 0,
      },
      {
        goodType: GOOD_WHEAT,
        capacity: ANIMAL_FARM_INPUT_CAPACITY,
        initial: 0,
      },
      {
        goodType: GOOD_SHEEP,
        capacity: ANIMAL_FARM_TOKEN_CAPACITY,
        initial: 0,
      },
      {
        goodType: GOOD_CATTLE,
        capacity: ANIMAL_FARM_TOKEN_CAPACITY,
        initial: 0,
      },
      {
        goodType: GOOD_WOOL,
        capacity: ANIMAL_FARM_OUTPUT_CAPACITY,
        initial: 0,
      },
      {
        goodType: GOOD_LEATHER,
        capacity: ANIMAL_FARM_OUTPUT_CAPACITY,
        initial: 0,
      },
      {
        goodType: GOOD_MEAT,
        capacity: ANIMAL_FARM_OUTPUT_CAPACITY,
        initial: 0,
      },
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
    ],
  },
  // Extracted shape ("work druid 00"): `logicproduction 15`, oil from a mushroom (`goodtypes.ini` holy_oil
  // `productionInputGoods 14`).
  [BUILDING_DRUID_HUT]: {
    stock: [
      { goodType: GOOD_MUSHROOM, capacity: DRUID_INPUT_CAPACITY, initial: 0 },
      { goodType: GOOD_HOLY_OIL, capacity: DRUID_HUT_OIL_CAPACITY, initial: 0 },
    ],
    produces: [GOOD_HOLY_OIL],
    recipes: [holyOilRecipe()],
  },
  // Extracted shape ("work druid 01"): the oil recipe plus the six potions, each brewed from water,
  // mushroom, herb and coin - one of each for a small bottle, two of each for a big one
  // (`productionInputGoods 1 14 13 8` / `1 1 14 14 13 13 8 8`).
  [BUILDING_DRUID_HUT_01]: {
    stock: [
      { goodType: GOOD_MUSHROOM, capacity: DRUID_INPUT_CAPACITY, initial: 0 },
      {
        goodType: GOOD_HOLY_OIL,
        capacity: DRUID_HUT_01_OUTPUT_CAPACITY,
        initial: 0,
      },
      { goodType: GOOD_WATER, capacity: DRUID_INPUT_CAPACITY, initial: 0 },
      { goodType: GOOD_HERB, capacity: DRUID_INPUT_CAPACITY, initial: 0 },
      { goodType: GOOD_COIN, capacity: DRUID_INPUT_CAPACITY, initial: 0 },
      ...POTIONS.map(([, goodType]) => ({
        goodType,
        capacity: DRUID_HUT_01_OUTPUT_CAPACITY,
        initial: 0,
      })),
    ],
    produces: [GOOD_HOLY_OIL, ...POTIONS.map(([, goodType]) => goodType)],
    recipes: [holyOilRecipe(), ...POTIONS.map(([amount, goodType]) => potionRecipe(goodType, amount))],
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
  // Extracted `work joinery 01..03` household-good lane: two wood become one furniture. The same rows
  // also retain the joinery's wooden- and iron-tool recipes.
  [BUILDING_JOINERY_01]: joineryUpgrade(20, CRAFT_INPUT_CAPACITY),
  // The level-3 joinery ("work joinery 02") also lists the handcart among its products
  // (`logicproduction 59`): its joiner's turn for a cart is a yard site beside the shop, not a cycle, so
  // the cart recipe carries no inputs; the yard's bill is what the cart costs.
  [BUILDING_JOINERY_02]: withVehicleTurns(joineryUpgrade(25, CRAFT_INPUT_CAPACITY), [GOOD_HANDCART]),
  // The level-4 joinery ("work joinery 03") adds the small ship and the catapult to its products
  // (`logicproduction 61 63`, the big ship left out of the sandbox); leather and iron feed their yards.
  [BUILDING_JOINERY_03]: withVehicleTurns(
    joineryUpgrade(25, JOINERY_03_INPUT_CAPACITY),
    [GOOD_HANDCART, GOOD_SHIP_SMALL, GOOD_CATAPULT],
    [{ goodType: GOOD_LEATHER, capacity: JOINERY_03_LEATHER_CAPACITY, initial: 0 }],
  ),
  // Extracted `work pottery 00/01`: the upgrade keeps bricks, adds tiles, and unlocks crockery.
  [BUILDING_POTTERY]: {
    stock: [
      { goodType: GOOD_MUD, capacity: CRAFT_INPUT_CAPACITY, initial: 0 },
      { goodType: GOOD_WOOD, capacity: CRAFT_INPUT_CAPACITY, initial: 0 },
      { goodType: GOOD_BRICK, capacity: 15, initial: 0 },
    ],
    produces: [GOOD_BRICK],
    recipes: [potteryRecipe(GOOD_BRICK, 1, 1)],
  },
  [BUILDING_POTTERY_01]: {
    stock: [
      { goodType: GOOD_MUD, capacity: CRAFT_INPUT_CAPACITY, initial: 0 },
      { goodType: GOOD_WOOD, capacity: CRAFT_INPUT_CAPACITY, initial: 0 },
      { goodType: GOOD_BRICK, capacity: 25, initial: 0 },
      { goodType: GOOD_TILE, capacity: 25, initial: 0 },
      { goodType: GOOD_CROCKERY, capacity: 25, initial: 0 },
    ],
    produces: [GOOD_BRICK, GOOD_TILE, GOOD_CROCKERY],
    recipes: [
      potteryRecipe(GOOD_BRICK, 1, 1),
      potteryRecipe(GOOD_TILE, 2, 1),
      potteryRecipe(GOOD_CROCKERY, 1, 2),
    ],
  },
};

/** A vehicle turn of a joinery: a yard site beside the shop, not a cycle, so the recipe carries no inputs
 *  and the yard's bill is what the vehicle costs. */
function vehicleTurn(goodType: number): SandboxRecipe {
  return { inputs: [], outputs: [{ goodType, amount: 1 }], ticks: DEFAULT_RECIPE_TICKS };
}

interface VehicleYard {
  readonly typeId: number;
  readonly id: string;
  readonly vehicleType: number;
  readonly construction: readonly { goodType: number; amount: number }[];
  readonly ignoreContinents?: boolean;
  readonly footprint: BuildingFootprint;
}

/** Cells `(dx, dy)` from a flat list. */
function cells(pairs: readonly (readonly [number, number])[]): { dx: number; dy: number }[] {
  return pairs.map(([dx, dy]) => ({ dx, dy }));
}

const HANDCART_BODY = cells([
  [0, -1],
  [0, 0],
  [1, 0],
  [0, 1],
]);
const SHIP_SMALL_BODY = cells([
  [-1, -2],
  [0, -2],
  [1, -2],
  [-2, -1],
  [-1, -1],
  [0, -1],
  [1, -1],
  [-2, 0],
  [-1, 0],
  [0, 0],
  [1, 0],
  [2, 0],
  [-2, 1],
  [-1, 1],
  [0, 1],
  [1, 1],
  [-1, 2],
  [0, 2],
  [1, 2],
]);
const CATAPULT_BODY = cells([
  [-1, -1],
  [0, -1],
  [-1, 0],
  [0, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
]);

/** The three yards the sandbox joineries raise, the real footprints of houses 42, 44 and 46. */
const VEHICLE_YARDS: readonly VehicleYard[] = [
  {
    typeId: BUILDING_HANDCART_YARD,
    id: 'handcart',
    vehicleType: VEHICLE_HANDCART,
    construction: [{ goodType: GOOD_WOOD, amount: HANDCART_YARD_WOOD }],
    footprint: {
      blocked: HANDCART_BODY,
      familyBody: HANDCART_BODY,
      reserved: cells([
        [0, -2],
        [1, -2],
        [-1, -1],
        [0, -1],
        [1, -1],
        [-1, 0],
        [0, 0],
        [1, 0],
        [2, 0],
        [-1, 1],
        [0, 1],
        [1, 1],
        [0, 2],
        [1, 2],
      ]),
      door: { dx: -1, dy: 1 },
    },
  },
  {
    typeId: BUILDING_SHIP_SMALL_YARD,
    id: 'ship_small',
    vehicleType: VEHICLE_SHIP_SMALL,
    construction: [
      { goodType: GOOD_LEATHER, amount: SHIP_YARD_LEATHER },
      { goodType: GOOD_WOOD, amount: SHIP_YARD_WOOD },
    ],
    ignoreContinents: true,
    footprint: {
      blocked: SHIP_SMALL_BODY,
      familyBody: SHIP_SMALL_BODY,
      reserved: cells([
        [-2, -3],
        [-1, -3],
        [0, -3],
        [1, -3],
        [-2, -2],
        [-1, -2],
        [0, -2],
        [1, -2],
        [2, -2],
        [-3, -1],
        [-2, -1],
        [-1, -1],
        [0, -1],
        [1, -1],
        [2, -1],
        [-3, 0],
        [-2, 0],
        [-1, 0],
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
        [5, 0],
        [-3, 1],
        [-2, 1],
        [-1, 1],
        [0, 1],
        [1, 1],
        [2, 1],
        [-2, 2],
        [-1, 2],
        [0, 2],
        [1, 2],
        [2, 2],
        [-2, 3],
        [-1, 3],
        [0, 3],
        [1, 3],
      ]),
      door: { dx: -2, dy: 3 },
    },
  },
  {
    typeId: BUILDING_CATAPULT_YARD,
    id: 'catapult',
    vehicleType: VEHICLE_CATAPULT,
    construction: [
      { goodType: GOOD_WOOD, amount: CATAPULT_YARD_WOOD },
      { goodType: GOOD_IRON, amount: CATAPULT_YARD_IRON },
    ],
    footprint: {
      blocked: CATAPULT_BODY,
      familyBody: CATAPULT_BODY,
      reserved: cells([
        [-1, -2],
        [0, -2],
        [1, -2],
        [-2, -1],
        [-1, -1],
        [0, -1],
        [1, -1],
        [-2, 0],
        [-1, 0],
        [0, 0],
        [1, 0],
        [2, 0],
        [-2, 1],
        [-1, 1],
        [0, 1],
        [1, 1],
        [-1, 2],
        [0, 2],
        [1, 2],
      ]),
      door: { dx: -1, dy: 2 },
    },
  },
];

/** A vehicle yard: no worker slot of its own, since the joiner building the vehicle crews the site. */
function vehicleYardRow(yard: VehicleYard): SandboxBuildingRow {
  return {
    typeId: yard.typeId,
    id: yard.id,
    kind: 'vehicle',
    vehicleType: yard.vehicleType,
    construction: yard.construction,
    hitpoints: buildingHitpoints('vehicle'),
    footprint: yard.footprint,
    ...(yard.ignoreContinents === true ? { ignoreContinents: true } : {}),
  };
}

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
    // Owned houses.ini: logicSchoolSize 5 for the school.
    ...(b.id === 'school' ? { schoolSize: 5 } : {}),
    construction: buildingConstructionCost(b),
    hitpoints: buildingHitpoints(b.kind),
    ...(upgradeTarget !== undefined ? { upgradeTarget } : {}),
    ...(b.buildOnBioPattern ? { buildOnBioPattern: true } : {}),
    ...(b.collectAtomic !== undefined ? { collectAtomic: b.collectAtomic } : {}),
    ...(b.refillsOwnStock ? { refillsOwnStock: true } : {}),
    ...(b.prayerSite !== undefined ? { prayerSite: b.prayerSite } : {}),
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
    buildings.set(b.typeId, {
      ...buildingRow(b),
      ...footprintOf(b.typeId, b.kind),
    });
  }
  for (const yard of VEHICLE_YARDS) buildings.set(yard.typeId, vehicleYardRow(yard));
  for (const b of extras.buildings ?? []) {
    if (!buildings.has(b.typeId)) {
      const kind = b.kind ?? 'workplace';
      buildings.set(b.typeId, {
        typeId: b.typeId,
        id: b.id,
        kind,
        ...footprintOf(b.typeId, kind),
      });
    }
  }
  return buildings;
}
