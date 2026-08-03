import type { Entity, Simulation } from '@open-northland/sim';
import { components, systems } from '@open-northland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { JOB_CARRIER, JOB_COLLECTOR } from '../catalog/jobs.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_WAREHOUSE_00,
  buildingDef,
  dropSandboxGood,
  GOOD_COIN,
  GOOD_GOLD,
  GOOD_IRON,
  GOOD_MUD,
  GOOD_MUSHROOM,
  GOOD_PLANK,
  GOOD_STONE,
  GOOD_WOOD,
  placeBuiltSandboxBuilding,
  spawnSandboxSettler,
  staffBuildingFully,
} from '../game/sandbox/index.js';
import { buildingOfType } from './sandbox-queries.js';
import type { SceneDefinition } from './types.js';

const MAP_W = 40;
const MAP_H = 34;
const INITIAL_ZOOM = 0.7;
/** Long enough for the wood to top out (~tick 4000, one foot-carried unit at a time) and for the
 *  carriers to then land a chunk of the other goods. */
const RUN_TICKS = 6000;

const WAREHOUSE_X = 20;
const WAREHOUSE_Y = 6;
/** The tech-enabling collector's corner, far from the store and the piles so it just idles. */
const ENABLER = { x: 2, y: MAP_H - 2 } as const;
/** The warehouse's carrier-slot count. */
const CARRIERS = 3;

/** Wood hugs the store, so it is worked first and fills the store to its cap with a surplus left over;
 *  the other goods sit farther out, well under the cap. */
const WOOD_OVERSUPPLY = 1.5;
const WOOD_ROW_Y = 9;
const WOOD_ROW_W = 12; // tiles per row
const SCATTER_ROW_Y = 20;
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

const STACK = systems.MAX_GROUND_STACK;

/** Read from content, so the scene stays tied to the real cap instead of a hardcoded limit. */
function warehouseCapacity(sim: Simulation, goodType: number): number {
  const def = buildingDef(sim, BUILDING_WAREHOUSE_00);
  return def?.stock?.find((s) => s.goodType === goodType)?.capacity ?? 0;
}

function build(sim: Simulation): void {
  const store = placeBuiltSandboxBuilding(sim, BUILDING_WAREHOUSE_00, WAREHOUSE_X, WAREHOUSE_Y, HUMAN_PLAYER);
  // Nobody employs themselves, so the scene posts the crew.
  staffBuildingFully(sim, store, HUMAN_PLAYER);

  spawnSandboxSettler(sim, JOB_COLLECTOR, ENABLER.x, ENABLER.y, HUMAN_PLAYER);

  const woodTiles = Math.ceil((warehouseCapacity(sim, GOOD_WOOD) * WOOD_OVERSUPPLY) / STACK);
  for (let i = 0; i < woodTiles; i++) {
    const x = WAREHOUSE_X - WOOD_ROW_W / 2 + (i % WOOD_ROW_W);
    const y = WOOD_ROW_Y + Math.floor(i / WOOD_ROW_W);
    dropSandboxGood(sim, GOOD_WOOD, x, y, STACK);
  }

  SCATTER_GOODS.forEach((good, g) => {
    for (let p = 0; p < SCATTER_PILES_PER_GOOD; p++) {
      const x = WAREHOUSE_X - SCATTER_GOODS.length + g * 2;
      const y = SCATTER_ROW_Y + p * 2;
      dropSandboxGood(sim, good, x, y, STACK);
    }
  });
}

const { Building, Carrying, JobAssignment, Position, Settler, Stockpile } = components;

function warehouse(sim: Simulation): Entity | null {
  return buildingOfType(sim, BUILDING_WAREHOUSE_00);
}

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

function warehouseHolding(sim: Simulation, goodType: number): number {
  const store = warehouse(sim);
  if (store === null) return 0;
  return sim.world.get(store, Stockpile).amounts.get(goodType) ?? 0;
}

/** A loose ground pile is a positioned Stockpile without a Building. */
function groundHolds(sim: Simulation, goodType: number): boolean {
  for (const e of sim.world.query(Stockpile, Position)) {
    if (sim.world.has(e, Building)) continue;
    if ((sim.world.get(e, Stockpile).amounts.get(goodType) ?? 0) > 0) return true;
  }
  return false;
}

function carriersHoldingWood(sim: Simulation): number {
  let holding = 0;
  for (const e of sim.world.query(Settler, Carrying)) {
    if (sim.world.get(e, Carrying).goodType === GOOD_WOOD) holding++;
  }
  return holding;
}

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
      label: 'the wood cap is enforced - the surplus wood is left resting on the ground, not forced in',
      predicate: (sim) => groundHolds(sim, GOOD_WOOD),
    },
    {
      label: 'the carriers moved on from the capped wood to the other goods (they did not jam on wood)',
      predicate: (sim) => warehouseOtherGoodsTotal(sim) > 0,
    },
    {
      label: 'no carrier is left stuck holding wood - the surplus was shed, not carried forever',
      predicate: (sim) => carriersHoldingWood(sim) === 0,
    },
  ],
};
