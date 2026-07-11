import type { Simulation } from '@vinland/sim';
import { grassTerrain } from '../catalog/buildings.js';
import { STORABLE_EXTENDED_GOODS } from '../catalog/goods.js';
import { HUMAN_PLAYER } from '../game/rules.js';
import {
  BUILDING_WAREHOUSE_02,
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

/**
 * The GLOBAL goods-catalog scene: proves the whole original goods catalog is available in every scene —
 * storable in a warehouse (with its HUD icon, across the eight category tabs) AND droppable on the ground.
 *
 * It places one warehouse (click it to read the full Magazyn) and drops one loose pile of EVERY storable
 * good on a grid, via the `dropGood` command. There are no settlers, so the piles simply rest where they
 * land — a static field of the full catalog for the human to eyeball. The headless half asserts the
 * catalog is wired (Phase 1), every good rests as its own pile (Phase 3), and the warehouse advertises a
 * stock slot for each (Phase 2).
 */

const MAP_W = 44;
const MAP_H = 40;
const INITIAL_ZOOM = 0.6;
/** No hauling happens (no settlers), so a short run is enough — the piles are static from tick 1. */
const RUN_TICKS = 60;

/** The warehouse to inspect — a level-2 store, which accepts the general-goods set (all storable goods). */
const WAREHOUSE_TILE = { x: 6, y: 5 };

/** Every storable good, core economy first then the extended catalog — one pile each on the drop grid. */
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

// The drop grid: a pile every 3 tiles, 8 across, below the warehouse.
const GRID_ORIGIN = { x: 4, y: 12 };
const GRID_COLUMNS = 8;
const GRID_STEP = 3;
/** A varied per-pile amount (1..5) so adjacent heaps stand at different heights — the pile graphic grows
 *  with its fill, so this shows the full range of growth states across the grid. */
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

/** The good typeIds the warehouse type advertises a stock slot for (its `stock` slots). */
function warehouseStockGoods(sim: Simulation): Set<number> {
  const def = sim.content.buildings.find((b) => b.typeId === BUILDING_WAREHOUSE_02);
  return new Set((def?.stock ?? []).map((s) => s.goodType));
}

/** Ids that must exist in the catalog — a spread across the extended families (proves Phase 1 is wired). */
const REPRESENTATIVE_EXTENDED_IDS = ['leather', 'bread', 'mead', 'armor_plate', 'sword_long'] as const;

export const goodsCatalogScene: SceneDefinition = {
  id: 'goods-catalog',
  title: 'Global goods catalog',
  summary:
    'Every good is globally available — stored in a warehouse with its icon, and dropped on the ground.',
  seed: 1,
  terrain: grassTerrain(MAP_W, MAP_H),
  build,
  runTicks: RUN_TICKS,
  initialZoom: INITIAL_ZOOM,
  checklist: [
    'Kliknij magazyn (u góry) — panel „Magazyn" pokazuje surowce z ikonkami.',
    'Zakładki kategorii (Żywność / Napoje / Surowce / Budulec / Narzędzia / Wyroby / Wojsko / Inne) przełączają widoczne surowce; każda ma swoje towary.',
    'Na ziemi leży siatka stosów RÓŻNYCH surowców (drewno, kamień, żelazo, skóra, chleb, miecze, zbroje…), każdy z własną grafiką stosu, o różnej wysokości (stos rośnie z ilością).',
    'Stosy leżą nieruchomo (brak tragarzy na mapie) — to statyczna wystawa całego katalogu.',
  ],
  checks: [
    {
      label: 'the full goods catalog is globally available (core economy + the extended catalog)',
      predicate: (sim) => {
        const ids = new Set(sim.content.goods.map((g) => g.id));
        return sim.content.goods.length >= 60 && REPRESENTATIVE_EXTENDED_IDS.every((id) => ids.has(id));
      },
    },
    {
      label: 'every storable good rests on the ground as its own loose pile',
      predicate: (sim) => countGroundPiles(sim) === DROP_GOODS.length,
    },
    {
      label: 'the warehouse advertises a stock slot for every dropped (storable) good',
      predicate: (sim) => {
        const stock = warehouseStockGoods(sim);
        return DROP_GOODS.every((good) => stock.has(good));
      },
    },
  ],
};
