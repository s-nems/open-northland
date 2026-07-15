import type { BuildingFootprint } from '@open-northland/data';
import { VIKING_BUILDINGS, type VikingBuilding } from '../../catalog/buildings.js';
import { approximateFootprint } from '../../catalog/footprints.js';
import { STORABLE_EXTENDED_GOODS } from '../../catalog/goods.js';
import { buildingConstructionCost, buildingHitpoints } from './construction.js';
import type { SandboxContentExtras } from './content/types.js';
import {
  BUILDING_FARM,
  BUILDING_HEADQUARTERS,
  BUILDING_JOINERY,
  BUILDING_MILL,
  BUILDING_WAREHOUSE_00,
  BUILDING_WAREHOUSE_01,
  BUILDING_WAREHOUSE_02,
  GOOD_COIN,
  GOOD_FLOUR,
  GOOD_GOLD,
  GOOD_IRON,
  GOOD_MUD,
  GOOD_MUSHROOM,
  GOOD_PLANK,
  GOOD_STONE,
  GOOD_WHEAT,
  GOOD_WOOD,
  JOB_GATHERER_WOOD,
} from './ids/index.js';
import { workerSlotsFor } from './worker-slots.js';

/**
 * The sandbox building set — the per-building store slots, capacities, recipes, and worker overrides
 * the global {@link import('./content/index.js').sandboxContent} set assembles its `buildings` field from
 * ({@link buildSandboxBuildings}). The hand-authored catalog stays pinned to ir.json; the stock/recipe
 * pins here are sandbox balance, not extracted data (see the per-table notes).
 */

// The farm's wheat-only store capacity — EXTRACTED: `logicstock 4 25 0` on the "work farm 00" block
// (`DataCnmd/types/houses.ini`), one slot, 25 wheat.
const FARM_WHEAT_CAPACITY = 25;
// The mill's two-slot store — EXTRACTED: `logicstock 4 10 1` (wheat, 10) + `logicstock 11 20 0`
// (flour, 20) on the "work mill 00" block (`DataCnmd/types/houses.ini`). The trailing logicstock int
// is the consumed-here flag (every workshop input and the homes' food carry 1, every pure storage
// slot 0), not an initial fill — so both slots start empty.
const MILL_WHEAT_CAPACITY = 10;
const MILL_FLOUR_CAPACITY = 20;
// One grind cycle's length — EXTRACTED: the `viking_miller_produce_flour` atomicanimation is
// `length 200` (`DataCnmd/atomicanimations12/atomicanimations.ini`; flour's `atomicForProduction 46`
// via `goodtypes.ini`), the same tick count the pipeline's `resolveRecipeTicks` pins into ir.json.
// The 1 wheat → 1 flour amounts are a NAMED APPROXIMATION: `productionInputGoods 4` names the input
// but no readable amount field exists.
const MILL_GRIND_TICKS = 200;

/** A store slot: how much of one good a general-goods building may hold, and its starting amount. */
export interface StockSlot {
  readonly goodType: number;
  readonly capacity: number;
  readonly initial: number;
}

/**
 * The general-goods store set — the core economy goods (the gathered set + plank + coin) followed by every
 * storable extended ware from {@link STORABLE_EXTENDED_GOODS}, so the HQ and warehouses advertise a slot for
 * the whole catalog and the Magazyn panel lists each good (with its icon) across its category tab. The set
 * (which goods a store holds) is a sandbox balance pin, not extracted data.
 */
const STORE_GOODS: readonly number[] = [
  GOOD_WOOD,
  GOOD_PLANK,
  GOOD_COIN,
  GOOD_STONE,
  GOOD_MUD,
  GOOD_IRON,
  GOOD_GOLD,
  GOOD_MUSHROOM,
  ...STORABLE_EXTENDED_GOODS.map((g) => g.typeId),
];

/**
 * Build a general-goods store's slot list at one per-good capacity — every good in {@link STORE_GOODS}
 * gets the same cap.
 */
function storeStock(capacity: number): readonly StockSlot[] {
  return STORE_GOODS.map((goodType) => ({ goodType, capacity, initial: 0 }));
}

/**
 * Per-good warehouse capacity by tier (`stock_00`/`stock_01`/`stock_02`) — a tier-N warehouse holds this
 * many of each stored good. User-requested sandbox balance, not extracted data (the real `logicstock`
 * caps are 45/70/120); these are the project's chosen sandbox limits.
 */
const WAREHOUSE_SLOT_CAPACITY = [100, 250, 500] as const;

/** The HQ's per-good store capacity — user-requested sandbox balance, the same 500 as the top warehouse
 *  tier and not extracted data (the real `logicstock` HQ cap is 150). */
const HQ_SLOT_CAPACITY = 500;

export interface SandboxBuildingRow {
  typeId: number;
  id: string;
  kind: string;
  stock?: readonly StockSlot[];
  construction?: readonly { goodType: number; amount: number }[];
  hitpoints?: number;
  recipe?: {
    inputs: readonly { goodType: number; amount: number }[];
    outputs: readonly { goodType: number; amount: number }[];
    ticks: number;
  };
  /** The goods this workplace makes (`logicproduction`) — for a farm this is the field-farmed good and
   *  there is deliberately no `recipe` (the field loop, not the abstract in-house cycle, produces it). */
  produces?: readonly number[];
  workers?: readonly { jobType: number; count: number }[];
  footprint?: BuildingFootprint;
}

/**
 * Per-building sandbox behaviour overrides, keyed by typeId — a data table, so {@link buildingRow}
 * stays a pure spread and a new special building means a new row here, not another branch. A `workers`
 * here replaces the extracted {@link import('./worker-slots.js').BUILDING_WORKER_SLOTS} default (the
 * joinery pins its own gatherer-fed plank producer for the production demo).
 */
const BUILDING_OVERRIDES: Readonly<Record<number, Partial<SandboxBuildingRow>>> = {
  [BUILDING_HEADQUARTERS]: { stock: storeStock(HQ_SLOT_CAPACITY) },
  // The grain farm — EXTRACTED shape (`DataCnmd/types/houses.ini` "work farm 00"): a wheat-only store
  // (`logicstock 4 25 0`) and `logicproduction 4` (produces wheat). Deliberately no recipe: the field
  // loop (its farmers sowing/watering/reaping around the building) is what makes the wheat — the
  // worker slots (4 farmers + 1 carrier) come from BUILDING_WORKER_SLOTS below.
  [BUILDING_FARM]: {
    stock: [{ goodType: GOOD_WHEAT, capacity: FARM_WHEAT_CAPACITY, initial: 0 }],
    produces: [GOOD_WHEAT],
  },
  // The mill — EXTRACTED shape (`DataCnmd/types/houses.ini` "work mill 00"): a wheat-in (10) /
  // flour-out (20) two-slot store and `logicproduction 11` (produces flour), ground by the standard
  // recipe cycle (wheat→flour 1:1 over the extracted 200-tick grind — see MILL_GRIND_TICKS). The
  // worker slots (2 millers + 1 carrier) come from BUILDING_WORKER_SLOTS below; the generic producer
  // drive gives the millers the whole fetch-wheat → grind → haul-flour-out loop with no mill code.
  [BUILDING_MILL]: {
    stock: [
      { goodType: GOOD_WHEAT, capacity: MILL_WHEAT_CAPACITY, initial: 0 },
      { goodType: GOOD_FLOUR, capacity: MILL_FLOUR_CAPACITY, initial: 0 },
    ],
    produces: [GOOD_FLOUR],
    recipe: {
      inputs: [{ goodType: GOOD_WHEAT, amount: 1 }],
      outputs: [{ goodType: GOOD_FLOUR, amount: 1 }],
      ticks: MILL_GRIND_TICKS,
    },
  },
  // The three warehouses accept the same general-goods set as the HQ (sandbox balance pin, not extracted
  // data) so the Magazyn section shows their storable goods instead of reading empty. Each tier's per-good
  // limit comes from the single {@link WAREHOUSE_SLOT_CAPACITY} table (100/250/500), not per-good literals.
  [BUILDING_WAREHOUSE_00]: { stock: storeStock(WAREHOUSE_SLOT_CAPACITY[0]) },
  [BUILDING_WAREHOUSE_01]: { stock: storeStock(WAREHOUSE_SLOT_CAPACITY[1]) },
  [BUILDING_WAREHOUSE_02]: { stock: storeStock(WAREHOUSE_SLOT_CAPACITY[2]) },
  [BUILDING_JOINERY]: {
    workers: [{ jobType: JOB_GATHERER_WOOD, count: 1 }],
    // A workplace general store (the plank-producer demo), capped like the HQ so the panel shows a sane
    // limit rather than a huge number.
    stock: storeStock(HQ_SLOT_CAPACITY),
    recipe: {
      inputs: [{ goodType: GOOD_WOOD, amount: 1 }],
      outputs: [{ goodType: GOOD_PLANK, amount: 1 }],
      ticks: 20,
    },
  },
};

function buildingRow(b: VikingBuilding): SandboxBuildingRow {
  const slots = workerSlotsFor(b.typeId);
  return {
    typeId: b.typeId,
    id: b.id,
    kind: b.kind,
    construction: buildingConstructionCost(b), // a deliverable bill so it raises as a construction site
    hitpoints: buildingHitpoints(b.kind), // the Health pool the ramp fills as it rises
    ...(slots !== undefined ? { workers: slots } : {}),
    ...BUILDING_OVERRIDES[b.typeId], // an override's `workers` (the joinery's demo) wins over the default
  };
}

/**
 * The building set: every hand-authored catalog building carrying its extracted-or-approximated footprint,
 * plus any extra buildings the caller declares. See {@link buildingRow} for the per-building shape.
 */
export function buildSandboxBuildings(extras: SandboxContentExtras): Map<number, SandboxBuildingRow> {
  // Real extracted footprints (live content) replace the hand-authored approximations wholesale — see
  // SandboxContentExtras.buildingFootprints. Without them every building approximates by class.
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
