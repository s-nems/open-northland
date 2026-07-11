import type { Entity, Simulation } from '@vinland/sim';
import { components, systems } from '@vinland/sim';
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
 * The WAREHOUSE-HAULING scene: prove a carrier ("Tragarz") ferries loose ground goods into the warehouse it
 * staffs, and STOPS at the store's per-good limit.
 *
 * One level-1 warehouse (`stock_00` → "Magazyn (poziom 1)", per-good cap 100) sits over a field of loose
 * good piles. Three carriers are spawned UNEMPLOYED next to it; because a passive store isn't adopted by a
 * settler standing at its door (only recipe workshops/farms are), the JobSystem's assign pass employs them
 * into the warehouse's three carrier slots (the lowest-job-id slot, {@link JOB_CARRIER}, fills first). Bound
 * to a store with no recipe, each becomes a PORTER: it collects the nearest loose pile and carries it home to
 * the warehouse, one unit per foot-trip. The deposit is capped per good by the store's stock slot
 * ({@link systems} `pileupIntoStore` → `stockCapacity`), so once a good reaches the limit the carrier keeps
 * its load and waits — no overflow.
 *
 * The loose WOOD supply is sized to EXACTLY the warehouse's own wood cap (read from content), so the store
 * fills to "100 / 100" and the field's wood is fully cleared with nothing left stuck on a back (goods are
 * conserved: cap-worth on the ground → cap-worth in the store). A scatter of other goods sits farther out for
 * the carriers to keep ferrying after the wood is in — the loaded field the human watches drain.
 *
 * Headless proves the mechanic: the three carriers are employed BY the warehouse, its wood reaches the cap,
 * no good exceeds its cap, and the ground field has shrunk. Browser is where a human watches the carriers
 * walk the piles in and the Magazyn panel climb to its limit.
 */

const MAP_W = 40;
const MAP_H = 34;
const INITIAL_ZOOM = 0.7;
/** Long enough for the three carriers to clear the whole wood field into the store (it tops out at the cap
 *  around tick 4500, one foot-carried unit at a time) — headless gate only; the browser view runs
 *  continuously, so a human watches the whole fill-up and the scatter drain regardless. */
const RUN_TICKS = 5000;

const WAREHOUSE_X = 20;
const WAREHOUSE_Y = 6;
/** Three carriers — the warehouse's carrier-slot count; spawned unemployed just below it so the assign pass
 *  staffs all three into its carrier slots on the first tick. */
const CARRIERS = 3;
const CARRIER_ROW_Y = 9;

/** The loose-good field: WOOD hugging the store (short trips, cleared first, fills the store to its cap), a
 *  scatter of other goods farther out (kept well under the cap, so every pile lands and none jams a carrier). */
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

  // WOOD sized to EXACTLY the wood cap, so the store fills to its limit and the field's wood clears with
  // nothing left over. Laid in full-stack tiles in rows near the store (the carriers' first, nearest work).
  const woodTiles = Math.ceil(warehouseCapacity(sim, GOOD_WOOD) / STACK);
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

const { Building, JobAssignment, Position, Settler, Stockpile } = components;

/** The one warehouse entity, or null before its placement command ran. */
function warehouse(sim: Simulation): Entity | null {
  for (const e of sim.world.query(Building)) {
    if (sim.world.get(e, Building).buildingType === BUILDING_WAREHOUSE_00) return e;
  }
  return null;
}

/** How many carriers ({@link JOB_CARRIER}) are employed BY the warehouse (bound via JobAssignment). */
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

/** Whether any LOOSE ground pile (a positioned Stockpile that is not a building store) still holds `goodType`. */
function groundHolds(sim: Simulation, goodType: number): boolean {
  for (const e of sim.world.query(Stockpile, Position)) {
    if (sim.world.has(e, Building)) continue;
    if ((sim.world.get(e, Stockpile).amounts.get(goodType) ?? 0) > 0) return true;
  }
  return false;
}

export const warehouseScene: SceneDefinition = {
  id: 'warehouse',
  title: 'Magazyn — tragarze zbierają towary',
  summary:
    'Trzej tragarze pracują w magazynie (poziom 1) i znoszą do niego luźne towary z ziemi — jeden po ' +
    'drugim. Magazyn zapełnia się do swojego limitu (drewno 100/100) i wtedy tragarz przestaje dokładać.',
  seed: 3,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checklist: [
    'Kliknij magazyn — panel „Magazyn (poziom 1)”, a w sekcji Pracownicy trzej Tragarze (3/3).',
    'Tragarze chodzą po luźne stosy towarów z ziemi i znoszą je do magazynu (po jednej sztuce na kurs).',
    'Licznik drewna w magazynie rośnie aż do limitu i zatrzymuje się na „100.0 / 100.0” — więcej się nie mieści.',
    'Po zebraniu drewna tragarze biorą się za pozostałe towary rozrzucone dalej — pole pustoszeje.',
  ],
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
      label: 'the carriers have cleared the wood field — no wood is left loose on the ground',
      predicate: (sim) => !groundHolds(sim, GOOD_WOOD),
    },
  ],
};
