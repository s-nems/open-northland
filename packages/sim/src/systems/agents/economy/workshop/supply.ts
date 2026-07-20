import type { Recipe } from '@open-northland/data';
import { Building, Production, Stockpile, UnderConstruction } from '../../../../components/index.js';
import { ONE } from '../../../../core/fixed.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SpatialGate } from '../../../../nav/node-metric.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { startableCycleCount } from '../../../economy/production.js';
import { buildingBlockedCells } from '../../../footprint/index.js';
import { recipesByProductOf, stockCapacity, typeProducesGoodWithoutInputs } from '../../../stores/index.js';
import { buriedUnderBuilding, type InteractionCellIndex } from '../../targets/index.js';

// The AI planner's SUPPLY layer: the scans behind a *producer worker running its own supply→produce→
// deliver loop* — the "kowal fetches the goods a sword needs, forges it, and carries it back" behavior.
// It sits beside the target-scan layer (targets/); ai.ts wires these into the per-settler decision.
//
// The split from the plain haul model: before this, inputs reached a workplace only because a harvester
// happened to deposit them there (`nearestStoreFor` picks the workplace when it's the nearest sink), and
// a worker just staffed the tile. That fails the moment inputs sit in a *warehouse* the harvester
// delivers to instead — the workplace starves. A producer now actively FETCHES the recipe inputs it is
// short on from a store that holds them, and HAULS its finished output out, so the loop closes without a
// dedicated carrier. Every choice is recipe-driven (no per-job/per-good hardcode) and canonically scanned
// (ascending entity-id, Manhattan + cell-id tie-break) so the winner never depends on store history.

/**
 * How many WORK SEATS the workplace offers this tick — the number of operators whose staying on the
 * station would actually run a batch: the cycles already grinding (each needs one present operator to
 * advance — see the ProductionSystem's FIFO rule) plus the further cycles the current stock could
 * start ({@link startableCycleCount}: inputs on hand, output room, tech gate). This is the producer's
 * "should I stay put?" gate, per worker instead of per building: the planner hands out seats in its
 * deterministic settler order, and a worker who finds them all taken is SURPLUS — its batch is done
 * or can't start, so it is freed to fetch inputs / haul output instead of idling inside while a
 * colleague's batch finishes (the "drugi młynarz czeka w środku" bug). An unbuilt/gone workplace
 * offers no seats. Reuses the ProductionSystem's own per-product start gate, so the planner and the
 * producer never disagree about whether a cycle can run. The further-seat estimate is the MAX over
 * the type's per-product recipes (named approximation: two spare operators choosing DIFFERENT
 * startable products the same tick would fill two seats where this counts one — the short-changed
 * worker fetches/loiters one tick and reclaims its seat next tick once the batch count has grown).
 */
export function workSeatCount(world: World, ctx: SystemContext, workplace: Entity): number {
  const running = world.tryGet(workplace, Production)?.cycles.length ?? 0;
  const b = world.tryGet(workplace, Building);
  if (b === undefined || b.built < ONE) return running; // a construction site never starts a cycle
  const recipes = recipesByProductOf(world, ctx, workplace);
  let startable = 0;
  for (const recipe of recipes?.values() ?? []) {
    startable = Math.max(startable, startableCycleCount(world, ctx, workplace, recipe));
  }
  return running + startable;
}

/**
 * Where a producer worker should go for a **missing recipe input**, or null when every input is already
 * stocked (or nothing reachable can supply one). Walks the recipe inputs in their (fixed content) order and,
 * for the FIRST input the workplace is short of, returns the single NEAREST source of EITHER kind:
 *  - `fetch`: a store that already holds the good — a warehouse, a flag pile, another workplace's output —
 *    with the amount still needed (so the trip carries exactly the shortfall, "tylko te wymagane");
 *  - `draw`: a built shared UTILITY that mints the good from no inputs (the well for water, the hive for
 *    honey — {@link producesGoodWithoutInputs}, data-driven, no hardcoded id) — the worker cranks it in
 *    place for one unit.
 *
 * Both kinds compete in ONE canonical scan (Manhattan + ascending-cell-id tie-break), so the CLOSER source
 * wins: a bakery beside a well draws its water there instead of trekking to a distant HQ that also holds
 * some, and vice versa (user rule 2026-07-19). A utility that happens to hold a produced unit qualifies as
 * a `fetch` (picking the standing unit up beats re-cranking).
 *
 * `restockToCapacity` raises each input's fetch target from the recipe amount (a craftsman fetching just
 * enough for the next cycle) to the workplace's declared input-slot CAPACITY — the bound CARRIER's shape:
 * it keeps the mill's wheat store topped up trip after trip (observed original behaviour). It does not
 * affect a `draw`, which always yields one unit.
 *
 * The workplace itself is excluded as a source, a construction site is skipped (its stock is delivered build
 * material, never a source to strip), and a pile buried under a building's walls is passed over (an
 * unreachable stand would strand the fetcher). `gate` is the fetcher's signpost confinement. The golden
 * slice is untouched: its only wood store IS the sawmill and nothing mints wood without inputs, so this
 * returns null and the operator stays pinned exactly as before.
 */
export type MissingInputSource =
  | { readonly kind: 'fetch'; readonly store: Entity; readonly goodType: number; readonly amount: number }
  | { readonly kind: 'draw'; readonly utility: Entity; readonly goodType: number };

const FETCH: { readonly payload: 'fetch' } = { payload: 'fetch' };
const DRAW: { readonly payload: 'draw' } = { payload: 'draw' };

export function nearestMissingInputSource(
  index: InteractionCellIndex,
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
  workplace: Entity,
  recipe: Recipe,
  restockToCapacity = false,
  gate?: SpatialGate,
): MissingInputSource | null {
  const stock = world.get(workplace, Stockpile).amounts;
  const walls = buildingBlockedCells(world, ctx, terrain);
  for (const input of recipe.inputs) {
    const have = stock.get(input.goodType) ?? 0;
    const target = restockToCapacity ? stockCapacity(world, ctx, workplace, input.goodType) : input.amount;
    if (have >= target) continue; // this input is already covered (for a cycle / to the slot's brim)
    const winner = index.nearest<'fetch' | 'draw'>(
      here,
      (e) => {
        if (e === workplace || world.has(e, UnderConstruction)) return null; // never self, never a build site
        // A store that HOLDS the good is a fetch (and beats a mint when it's the nearer of the two); a
        // buried pile is skipped (an unreachable stand strands the fetcher — the `nearestStoreHolding` guard).
        if ((world.get(e, Stockpile).amounts.get(input.goodType) ?? 0) > 0) {
          return buriedUnderBuilding(world, terrain, walls, e) ? null : FETCH;
        }
        // Else a built utility that MINTS the good from no inputs is a draw (crank it in place for one unit).
        const b = world.tryGet(e, Building);
        if (
          b !== undefined &&
          b.built >= ONE &&
          typeProducesGoodWithoutInputs(ctx, b.buildingType, input.goodType)
        ) {
          return DRAW;
        }
        return null;
      },
      gate,
    );
    if (winner === null) continue;
    return winner.payload === 'draw'
      ? { kind: 'draw', utility: winner.entity, goodType: input.goodType }
      : { kind: 'fetch', store: winner.entity, goodType: input.goodType, amount: target - have };
  }
  return null;
}

/**
 * The finished OUTPUT good a producer should haul out of its own workplace (to clear it so the next cycle
 * fits, and to carry the product to a store), or null if the workplace holds no deliverable output. A
 * candidate good is a recipe output the workplace currently stocks (>0) that some OTHER store can accept
 * ({@link nearestStoreFor} finds a sink) — walked in `recipe.outputs` order (a fixed content array, not a
 * Map, so the pick never depends on store insertion history), first deliverable output wins. The producer
 * only reaches this when it holds no work seat right now ({@link workSeatCount} exhausted), so
 * hauling its output never steals a tick it should have spent producing.
 */
export function workplaceOutputToHaul(
  deliverable: (goodType: number, from?: Entity) => boolean,
  world: World,
  workplace: Entity,
  recipe: Recipe,
): number | null {
  const stock = world.get(workplace, Stockpile).amounts;
  for (const output of recipe.outputs) {
    if ((stock.get(output.goodType) ?? 0) <= 0) continue; // nothing of this output on hand
    // Deliverable somewhere that isn't this workplace? (The routing itself excludes the producer.)
    if (deliverable(output.goodType, workplace)) {
      return output.goodType;
    }
  }
  return null;
}
