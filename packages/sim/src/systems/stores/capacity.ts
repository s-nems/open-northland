import type { BuildingType } from '@open-northland/data';
import {
  Building,
  DeliveryFlag,
  GroundDrop,
  Position,
  Stockpile,
  stockpileEntries,
  Vehicle,
} from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { vehicleMayCarry } from '../readviews/vehicles.js';
import { homeNextTier } from './housing.js';

// What a store can hold: per-good stockpile capacity across the store kinds (construction site, built
// building, boat hull, loose ground heap) plus the ground-heap predicates the gathering economy shares.

/** The capacity a bare position-less test-fixture store (no Building/Vehicle type, not on the map)
 *  advertises — uncapped, so a mapless fixture still accepts deposits. */
const UNCAPPED_CAPACITY = Number.MAX_SAFE_INTEGER;

/**
 * The most units of one good a loose ground heap can hold on one tile — the engine's global per-tile limit
 * for goods resting on the ground. Source basis: extracted — every good-pile `[GfxLandscape]` record declares
 * `LogicMaximumValency 5` (uniform across all 43 "good piles" rows in `ir.json`'s `landscapeGfx[].maxValency`),
 * matching observed original behaviour and the `ls_goods.bmd` art's 5 fill states per good. Kept as one engine
 * constant while the value is uniform; if a mod ever varies it per good, this moves onto the per-record
 * `maxValency`.
 */
export const MAX_GROUND_STACK = 5;

/**
 * The per-good capacity of a store's stockpile. Every branch returns the total per-good ceiling; callers
 * subtract what's on hand (`nearestStoreFor`'s `have >= capacity` full-check, `pileup`'s `capacity - have`).
 *
 * - An **under-construction building** (a {@link Building} still at `built < ONE`): the per-good ceiling is
 *   that good's line in the building type's `construction` cost; any other good gets 0 (refused). So a site
 *   advertises room for exactly its outstanding materials — the carrier path hauls the `construction` goods
 *   in and the ConstructionSystem consumes them and flips `built`. An unbuilt building never produces
 *   (`productionSystem` gates on `built >= ONE`), so its stockpile can't be raided to feed a recipe.
 * - A built **building** store: from its building type's stock slots — a good with no declared slot gets 0.
 *   An upgradable built `home` ({@link homeNextTier}) also advertises room for its next tier's `construction`
 *   materials: the ceiling is the larger of the stock-slot capacity and the next tier's cost-line `amount`,
 *   so the same carrier path accumulates upgrade materials at a still-upgradable home; `constructionSystem`
 *   consumes them and levels it up. A top-tier home reverts to its plain stock-slot capacity.
 * - A **boat hull** ({@link Vehicle} carrying a `Stockpile`): gated by the ship's `cargoGoods` allow-list — a
 *   good the hold may carry ({@link vehicleMayCarry}) gets the whole `stockSlots` capacity, one it may not
 *   gets 0. The `stockSlots` total is applied as a per-good upper bound (the whole-hold-shared-across-goods
 *   cap is a deferred refinement; see source basis).
 * - A **loose ground heap** (a positioned Stockpile with neither Building nor Vehicle): the global per-tile
 *   limit, {@link MAX_GROUND_STACK} units of the one good it holds; a heap already holding a different good
 *   refuses ours (capacity 0 — piles never mix goods, matching `stackOntoTile`/`dropOrStackGood`).
 * - A store with **none** of the above and no Position (a mapless test fixture) stays uncapped.
 *
 * Used by the AI store scan (`nearestStoreFor`), the atomic `pileup` deposit, and production's
 * `canStartCycle`/`depositOutputs`.
 */
export function stockCapacity(world: World, ctx: SystemContext, store: Entity, goodType: number): number {
  const building = world.tryGet(store, Building);
  if (building !== undefined) {
    const type = contentIndex(ctx.content).buildings.get(building.buildingType);
    if (type === undefined) return 0;
    return buildingStockCapacity(ctx, type, building.built, goodType);
  }
  const hull = world.tryGet(store, Vehicle);
  if (hull !== undefined) {
    const type = contentIndex(ctx.content).vehicles.get(hull.vehicleType);
    if (type === undefined) return 0;
    return vehicleMayCarry(type, goodType) ? type.stockSlots : 0;
  }
  const stock = world.tryGet(store, Stockpile);
  if (stock !== undefined && world.has(store, Position)) {
    // Broader than {@link isYardHeap} (the sink/pick predicate): the ground clamp applies to every
    // building-less, hull-less pile on the map — a yard heap, a flag pile, or an uncollected GroundDrop
    // trunk. Trunks/flags are excluded from being chosen as delivery sinks elsewhere; this is only what a
    // pile could hold if something did deposit into it.
    const held = lowestStockedGood(stock);
    if (held !== null && held !== goodType) return 0; // a ground heap never mixes goods
    return MAX_GROUND_STACK;
  }
  return UNCAPPED_CAPACITY;
}

/** The building branch of {@link stockCapacity}, pure over content + the `built` progress — the
 *  construction-site / stock-slot / home-upgrade capacity math, unit-testable without a world. */
function buildingStockCapacity(
  ctx: SystemContext,
  type: BuildingType,
  built: number,
  goodType: number,
): number {
  if (built < ONE) {
    // Construction site: the per-good ceiling is the building's full `construction` cost for that material
    // (a non-material good gets 0 — refused).
    const line = type.construction.find((c) => c.goodType === goodType);
    return line?.amount ?? 0;
  }
  // Built building: its normal per-good stock-slot ceiling…
  const slot = type.stock.find((s) => s.goodType === goodType);
  const slotCapacity = slot?.capacity ?? 0;
  // …plus, for a built `home` that can still level up, room for the next tier's construction materials. Take
  // the larger of the two ceilings (a good can be both a stocked good and an upgrade material); a top-tier
  // home has no next tier and keeps only its stock-slot capacity.
  const next = homeNextTier(type, ctx);
  if (next === undefined) return slotCapacity;
  const upgradeLine = next.construction.find((c) => c.goodType === goodType);
  return Math.max(slotCapacity, upgradeLine?.amount ?? 0);
}

/** The lowest-id good a stockpile holds ≥1 unit of, or null if it is empty. Canonical (ascending
 *  goodType via {@link stockpileEntries}) so a pick keyed off it never depends on Map insertion order.
 *  The shared building block behind the ground-pile scans (`nearestGroundPile`, the collect-trunk drive). */
export function lowestStockedGood(stock: { amounts: Map<number, number> }): number | null {
  for (const [goodType, amount] of stockpileEntries(stock)) if (amount > 0) return goodType;
  return null;
}

/**
 * Whether `e` is a loose gatherer-yard heap — a bare {@link Stockpile}+{@link Position} that is none of a
 * persistent store ({@link Building} warehouse / {@link Vehicle} hull), an uncollected {@link GroundDrop}
 * trunk, or a {@link DeliveryFlag} marker. The one shared definition of "a settled goods heap resting on the
 * ground": the tile a flag-bound gatherer stacks onto (`stackOntoTile`), a candidate the yard search considers
 * (`nearestFreeYardNode`), and what a scene check sums (`yardGood`).
 */
export function isYardHeap(world: World, e: Entity): boolean {
  return (
    world.has(e, Stockpile) &&
    world.has(e, Position) &&
    !world.has(e, Building) &&
    !world.has(e, Vehicle) &&
    !world.has(e, GroundDrop) &&
    !world.has(e, DeliveryFlag)
  );
}
