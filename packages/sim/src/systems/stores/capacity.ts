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

// What a store can HOLD: per-good stockpile capacity across the store kinds (construction site, built
// building, boat hull, loose ground heap) plus the ground-heap predicates the gathering economy shares.

/** The capacity a bare POSITION-LESS test-fixture store (no Building/Vehicle type, not on the map)
 *  advertises — uncapped, so a mapless fixture still accepts deposits. */
const UNCAPPED_CAPACITY = Number.MAX_SAFE_INTEGER;

/**
 * The most units of ONE good a loose ground heap can hold on one tile — the engine's GLOBAL per-tile
 * limit for goods resting on the ground (a gatherer's yard heap, a hand-dropped pile, and a delivered
 * load alike). Source basis: EXTRACTED — every good-pile `[GfxLandscape]` record declares
 * `LogicMaximumValency 5` (uniform across all 43 "good piles" rows in the generated `ir.json`'s
 * `landscapeGfx[].maxValency`), matching observed original behaviour and the `ls_goods.bmd` art's 5
 * fill states per good. Kept as one engine constant while the value is uniform; if a mod ever varies
 * it per good, this moves onto the extracted per-record `maxValency`.
 */
export const MAX_GROUND_STACK = 5;

/**
 * The per-good capacity of a store's stockpile.
 *
 * - An **under-construction building** (a {@link Building} still at `built < ONE` — a construction
 *   site): its per-good ceiling is the material-DELIVERY demand from its building type's `construction`
 *   cost. A good named by the cost gets that cost line's full `amount` (the TOTAL ceiling, like every
 *   other store — callers subtract what's on hand: `nearestStoreFor`'s `have >= capacity` full-check,
 *   `pileup`'s `capacity - have` space); any other good gets 0 (refused). So a site advertises room for
 *   *exactly* its outstanding materials and nothing else — `nearestStoreFor` only delivers a good to a
 *   store with room, so the existing carrier path hauls the `construction` goods to the site (the
 *   `pileup` deposit capped at the outstanding need), and the ConstructionSystem then consumes them and
 *   flips `built`. (An unbuilt building never produces — `productionSystem` gates its start loop on
 *   `built >= ONE` — so this branch's only consumer is the carrier-delivery of build materials; its
 *   stockpile can't be raided to feed a recipe.)
 * - A built **building** store: from its building type's stock slots — a good with no declared slot
 *   has no room (capacity 0). **Plus** an upgradable **built `home`** ({@link homeNextTier} — a `home`
 *   with a next tier in the level chain) also advertises room for its NEXT tier's `construction`
 *   materials: the per-good ceiling is the **larger** of the normal stock-slot capacity and the next
 *   tier's cost-line `amount`, so the same carrier path that delivers a build-site's materials now also
 *   accumulates the upgrade materials at a still-upgradable home (closing the births→housing→upgrade→
 *   more-housing loop with no upgrade-specific transport code). The `constructionSystem` then consumes
 *   them and levels the home up. The top-tier home (no next tier) reverts to its plain stock-slot
 *   capacity, so a maxed home stops attracting materials — exactly like a finished build site.
 * - A **boat hull** ({@link Vehicle}, the "boats as mobile stores" entity — a `Stockpile` on a hull,
 *   not a building): gated by the ship's `cargoGoods` **load allow-list** — a good the hold may carry
 *   ({@link vehicleMayCarry}) gets the whole `stockSlots` hold capacity, a good it may **not** carry
 *   gets 0 (refused, so a carrier never deposits a forbidden good into a boat). This is the *load
 *   half* of "boats as mobile stores": the hull was placed empty (the `placeBoat` command); here a
 *   haul INTO it is filtered by what the vehicle type may hold and bounded by how much. The `stockSlots`
 *   total is applied as a per-good upper bound (a faithful upper bound — the whole-hold-shared-across-
 *   goods cap is a deferred refinement; see source basis).
 * - A **loose ground heap** (a positioned Stockpile with neither Building nor Vehicle — a gatherer's
 *   yard heap or a hand-dropped pile): the engine's global per-tile limit, {@link MAX_GROUND_STACK}
 *   units of the ONE good it holds; a heap already holding a DIFFERENT good refuses ours outright
 *   (capacity 0 — piles never mix goods, matching `stackOntoTile`/`dropOrStackGood`). This is what
 *   keeps a delivery (`nearestStoreFor` + `pileup`) from banking an unbounded heap of flour on a
 *   field tile — a full heap stops advertising room and the load routes to a real store instead.
 * - A store with **none** of the above and no Position (a mapless test fixture) stays uncapped.
 *
 * Cross-system: used by the AI store scan (`nearestStoreFor`), the atomic `pileup` deposit,
 * and production's `canStartCycle`/`depositOutputs`.
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
    // DELIBERATELY broader than {@link isYardHeap} (the sink/pick predicate): the ground clamp
    // applies to EVERY building-less, hull-less pile on the map — a yard heap, a flag pile, and an
    // uncollected GroundDrop trunk alike (nothing resting on a tile exceeds the per-tile valency).
    // Trunks/flags are excluded from being CHOSEN as delivery sinks elsewhere; this is only what a
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
    // Construction site: the per-good ceiling is the building's full `construction` cost for that
    // material (a non-material good gets 0 — refused). Like every store, this is the TOTAL capacity;
    // callers (`nearestStoreFor`'s `have >= capacity` full-check, `pileup`'s `capacity - have` space)
    // subtract what's on hand, so a site advertises room until it holds the whole cost line.
    const line = type.construction.find((c) => c.goodType === goodType);
    return line?.amount ?? 0;
  }
  // Built building: its normal per-good stock-slot ceiling…
  const slot = type.stock.find((s) => s.goodType === goodType);
  const slotCapacity = slot?.capacity ?? 0;
  // …plus, for a built `home` that can still level up, room for the NEXT tier's outstanding
  // construction materials, so the existing carrier path accumulates the upgrade materials at the
  // home. Take the larger of the two ceilings (a good can be both a stocked good and an upgrade
  // material); a maxed-out (top-tier) home has no next tier and keeps only its stock-slot capacity.
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
 * Whether `e` is a **loose gatherer-yard heap** — a bare {@link Stockpile}+{@link Position} that is NONE of
 * a persistent store ({@link Building} warehouse / {@link Vehicle} hull), an uncollected {@link GroundDrop}
 * trunk, or a {@link DeliveryFlag} marker. This is the ONE definition of "a settled goods heap resting on
 * the ground" the gathering economy shares: the tile a flag-bound gatherer stacks onto (`stackOntoTile`),
 * a candidate the yard search considers (`nearestFreeYardNode`), and what a scene check sums (`yardGood`).
 * Keeping it in one place stops those call sites from drifting when a future marker must also be excluded.
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
