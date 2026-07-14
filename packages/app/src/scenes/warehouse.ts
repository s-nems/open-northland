import type { Entity, Simulation } from '@open-northland/sim';
import { components, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_WAREHOUSE_00,
  dropSandboxGood,
  GOOD_COIN,
  GOOD_GOLD,
  GOOD_IRON,
  GOOD_MUD,
  GOOD_MUSHROOM,
  GOOD_PLANK,
  GOOD_STONE,
  GOOD_WOOD,
  JOB_CARRIER,
  placeSandboxBuilding,
  spawnIdleSettler,
} from '../game/sandbox/index.js';
import type { SceneDefinition } from './types.js';

/**
 * The warehouse-hauling scene: a carrier ("Tragarz") ferries loose ground goods into the warehouse it
 * staffs, stops at the store's per-good limit, and moves on to the next good instead of jamming.
 *
 * One level-1 warehouse (`stock_00` → "Magazyn (poziom 1)", per-good cap 100) sits over a field of loose
 * piles. Three carriers spawn unemployed beside it; a passive store isn't adopted by a settler at its door
 * (only recipe workshops/farms are), so the JobSystem assign pass employs them into its three carrier slots
 * ({@link JOB_CARRIER} fills first). Bound to a recipe-less store, each becomes a porter: it collects the
 * nearest loose pile whose good the store can still take and carries it home one unit per foot-trip.
 *
 * Wood is over-supplied (1.5× its cap, read from content) nearest the door, so the store fills to 100/100 and
 * the cap bites: the carriers stop hauling wood (the ~50 surplus rests on the ground) and switch to the goods
 * farther out — no pick-up/put-down loop, no carrier stuck holding a unit it can't deposit. A porter never
 * lifts a good the store is full of and sheds any surplus it is already carrying.
 *
 * Headless proves the mechanic; the browser is where a human watches the wood counter stop at 100 and the
 * carriers walk off to the rest of the field.
 */

const MAP_W = 40;
const MAP_H = 34;
const INITIAL_ZOOM = 0.7;
/** Long enough for the wood to top out (~tick 4000, one foot-carried unit at a time) and for the carriers to
 *  then land a chunk of the other goods — headless gate only; the browser view runs continuously. */
const RUN_TICKS = 6000;

const WAREHOUSE_X = 20;
const WAREHOUSE_Y = 6;
/** Three carriers — the warehouse's carrier-slot count; spawned unemployed just below it so the assign pass
 *  staffs all three into its carrier slots on the first tick. */
const CARRIERS = 3;
const CARRIER_ROW_Y = 9;

/** The loose-good field: wood hugging the store (short trips, worked first, fills the store to its cap with a
 *  surplus left over), a scatter of other goods farther out (well under the cap, worked once wood tops out). */
const WOOD_OVERSUPPLY = 1.5; // 1.5× the cap, so the store fills to 100 and ~50 wood is left resting on the ground
const WOOD_ROW_Y = 9; // the wood field starts right below the store — a short carry so the fill reads quickly
const WOOD_ROW_W = 12; // wood tiles per row (a compact block tight around the door)
const SCATTER_ROW_Y = 20; // the varied goods farther out, worked once the wood is in
const SCATTER_PILES_PER_GOOD = 3;
const SCATTER_GOODS = [
  GOOD_STONE,
  GOOD_IRON,
  GOOD_GOLD,
  GOOD_MUD,
  GOOD_MUSHROOM,
  GOOD_PLANK,
  GOOD_COIN,
] as const;

const STACK = systems.MAX_GROUND_STACK; // the most one tile's pile holds — every drop fills a tile to this

/** The warehouse type's per-good stock capacity for `goodType`, read from content so the scene stays tied to
 *  the real cap (no hardcoded limit). */
function warehouseCapacity(sim: Simulation, goodType: number): number {
  const def = sim.content.buildings.find((b) => b.typeId === BUILDING_WAREHOUSE_00);
  return def?.stock?.find((s) => s.goodType === goodType)?.capacity ?? 0;
}

function build(sim: Simulation): void {
  placeSandboxBuilding(sim, BUILDING_WAREHOUSE_00, WAREHOUSE_X, WAREHOUSE_Y, HUMAN_PLAYER);

  // Three unemployed settlers by the warehouse — the assign pass employs them into its carrier slots.
  for (let i = 0; i < CARRIERS; i++) {
    spawnIdleSettler(sim, WAREHOUSE_X - 1 + i, CARRIER_ROW_Y, HUMAN_PLAYER);
  }

  // Wood over-supplied (1.5× cap), in full-stack tiles in rows near the store (worked first): the store
  // fills and the surplus stays on the ground.
  const woodTiles = Math.ceil((warehouseCapacity(sim, GOOD_WOOD) * WOOD_OVERSUPPLY) / STACK);
  for (let i = 0; i < woodTiles; i++) {
    const x = WAREHOUSE_X - WOOD_ROW_W / 2 + (i % WOOD_ROW_W);
    const y = WOOD_ROW_Y + Math.floor(i / WOOD_ROW_W);
    dropSandboxGood(sim, GOOD_WOOD, x, y, STACK);
  }

  // A scatter of other goods farther out — full-stack tiles, kept well under the cap so they all land.
  SCATTER_GOODS.forEach((good, g) => {
    for (let p = 0; p < SCATTER_PILES_PER_GOOD; p++) {
      const x = WAREHOUSE_X - SCATTER_GOODS.length + g * 2;
      const y = SCATTER_ROW_Y + p * 2;
      dropSandboxGood(sim, good, x, y, STACK);
    }
  });
}

const { Building, Carrying, JobAssignment, Position, Settler, Stockpile } = components;

/** The one warehouse entity, or null before its placement command ran. */
function warehouse(sim: Simulation): Entity | null {
  for (const e of sim.world.query(Building)) {
    if (sim.world.get(e, Building).buildingType === BUILDING_WAREHOUSE_00) return e;
  }
  return null;
}

/** How many carriers ({@link JOB_CARRIER}) are employed by the warehouse (bound via JobAssignment). */
function carriersEmployedByWarehouse(sim: Simulation): number {
  const store = warehouse(sim);
  if (store === null) return 0;
  let bound = 0;
  for (const e of sim.world.query(Settler, JobAssignment)) {
    if (sim.world.get(e, JobAssignment).workplace !== store) continue;
    if (sim.world.get(e, Settler).jobType === JOB_CARRIER) bound++;
  }
  return bound;
}

/** The warehouse's current holding of `goodType`. */
function warehouseHolding(sim: Simulation, goodType: number): number {
  const store = warehouse(sim);
  if (store === null) return 0;
  return sim.world.get(store, Stockpile).amounts.get(goodType) ?? 0;
}

/** Whether any loose ground pile (a positioned Stockpile that is not a building store) still holds `goodType`. */
function groundHolds(sim: Simulation, goodType: number): boolean {
  for (const e of sim.world.query(Stockpile, Position)) {
    if (sim.world.has(e, Building)) continue;
    if ((sim.world.get(e, Stockpile).amounts.get(goodType) ?? 0) > 0) return true;
  }
  return false;
}

/** How many carriers are still holding wood — should be 0 after the cap: a porter sheds any surplus it was
 *  already carrying. */
function carriersHoldingWood(sim: Simulation): number {
  let holding = 0;
  for (const e of sim.world.query(Settler, Carrying)) {
    if (sim.world.get(e, Carrying).goodType === GOOD_WOOD) holding++;
  }
  return holding;
}

/** Total units of goods other than wood the warehouse holds — proof the carriers moved on from the capped
 *  wood to the rest of the field. */
function warehouseOtherGoodsTotal(sim: Simulation): number {
  const store = warehouse(sim);
  if (store === null) return 0;
  let total = 0;
  for (const [goodType, amount] of sim.world.get(store, Stockpile).amounts) {
    if (goodType !== GOOD_WOOD) total += amount;
  }
  return total;
}

export const warehouseScene: SceneDefinition = {
  id: 'warehouse',
  seed: 3,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checks: [
    {
      label: 'all three carriers are employed BY the warehouse (bound as Tragarz)',
      predicate: (sim) => carriersEmployedByWarehouse(sim) === CARRIERS,
    },
    {
      label: 'the warehouse fills with wood up to its per-good limit (100 / 100)',
      predicate: (sim) => warehouseHolding(sim, GOOD_WOOD) === warehouseCapacity(sim, GOOD_WOOD),
    },
    {
      label: 'no good in the warehouse exceeds its per-good limit',
      predicate: (sim) => {
        const store = warehouse(sim);
        if (store === null) return false;
        for (const [goodType, amount] of sim.world.get(store, Stockpile).amounts) {
          if (amount > warehouseCapacity(sim, goodType)) return false;
        }
        return true;
      },
    },
    {
      label: 'the wood cap is enforced — the surplus wood is left resting on the ground, not forced in',
      predicate: (sim) => groundHolds(sim, GOOD_WOOD),
    },
    {
      label: 'the carriers moved on from the capped wood to the other goods (they did not jam on wood)',
      predicate: (sim) => warehouseOtherGoodsTotal(sim) > 0,
    },
    {
      label: 'no carrier is left stuck holding wood — the surplus was shed, not carried forever',
      predicate: (sim) => carriersHoldingWood(sim) === 0,
    },
  ],
};
