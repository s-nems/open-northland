import type { Recipe } from '@open-northland/data';
import { Building, Production, Stockpile } from '../../../../components/index.js';
import { ONE } from '../../../../core/fixed.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import { startableCycleCount } from '../../../economy/production.js';
import type { SpatialGate } from '../../../node-metric.js';
import { recipesByProductOf, stockCapacity } from '../../../stores/index.js';
import type { InteractionCellIndex } from '../../targets/index.js';
import type { SinkAvailability } from '../../targets/stores/sinks.js';

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
 * The nearest store the producer should fetch a **missing recipe input** from, or null if every input is
 * already stocked at the workplace or no store holds a missing one. Walks the recipe inputs in their
 * (fixed content) order and returns the FIRST input the workplace is short of that some OTHER store
 * holds — the good, the amount still needed (so the fetch carries exactly the shortfall, "tylko te
 * wymagane"), and the nearest store holding it (Manhattan + ascending-cell-id tie-break, canonical scan).
 *
 * `restockToCapacity` raises each input's target from the recipe amount (a craftsman fetching just
 * enough for the next cycle) to the workplace's declared input-slot CAPACITY — the bound CARRIER's
 * shape: it keeps the mill's wheat store topped up trip after trip so the millers never starve, and
 * only stops when the slot is full (observed original behaviour: the carrier stocks the workshop, the
 * craftsman crafts).
 *
 * The workplace itself is excluded as a source (a producer never pulls its own stock back out); any other
 * positioned {@link Stockpile} that holds the good is a valid source — a warehouse, a flag pile, or even
 * another workplace's output. This is what makes the golden slice untouched: there, the only store that
 * ever holds the sawmill's input (wood) IS the sawmill, so this returns null and the operator stays
 * pinned exactly as before — the fetch only fires once an input lives in a *separate* store.
 */
export function nearestMissingInputSource(
  index: InteractionCellIndex,
  world: World,
  ctx: SystemContext,
  here: NodeId,
  workplace: Entity,
  recipe: Recipe,
  restockToCapacity = false,
  gate?: SpatialGate,
): { store: Entity; goodType: number; amount: number } | null {
  const stock = world.get(workplace, Stockpile).amounts;
  for (const input of recipe.inputs) {
    const have = stock.get(input.goodType) ?? 0;
    const target = restockToCapacity ? stockCapacity(world, ctx, workplace, input.goodType) : input.amount;
    if (have >= target) continue; // this input is already covered (for a cycle / to the slot's brim)
    // The stockpile index holds every Stockpile+Position candidate; source any store that isn't the
    // workplace itself and holds the good (a warehouse, a flag pile, another workplace's output).
    // `gate` is the fetcher's signpost confinement — an out-of-area store is not a known source.
    const winner = index.nearest(
      here,
      (e) => e !== workplace && (world.get(e, Stockpile).amounts.get(input.goodType) ?? 0) > 0,
      gate,
    );
    if (winner !== null) return { store: winner.entity, goodType: input.goodType, amount: target - have };
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
  sinks: SinkAvailability,
  world: World,
  workplace: Entity,
  recipe: Recipe,
): number | null {
  const stock = world.get(workplace, Stockpile).amounts;
  for (const output of recipe.outputs) {
    if ((stock.get(output.goodType) ?? 0) <= 0) continue; // nothing of this output on hand
    // Deliverable somewhere that isn't this workplace? (nearestStoreFor already excludes the producer.)
    if (sinks.has(output.goodType)) {
      return output.goodType;
    }
  }
  return null;
}
