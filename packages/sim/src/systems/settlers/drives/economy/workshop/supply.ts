import type { Recipe } from '@open-northland/data';
import {
  Building,
  Production,
  Stockpile,
  sameSideAs,
  UnderConstruction,
} from '../../../../../components/index.js';
import { ONE } from '../../../../../core/fixed.js';
import type { Entity, World } from '../../../../../ecs/world.js';
import type { SpatialGate } from '../../../../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../../context.js';
import { craftablePool, startableCycleCount } from '../../../../economy/production.js';
import { buildingBlockedCells } from '../../../../footprint/index.js';
import {
  mayFetchGoodFrom,
  recipesByProductOf,
  stockCapacity,
  typeProducesGoodWithoutInputs,
} from '../../../../stores/index.js';
import { buriedUnderBuilding, type InteractionCellIndex } from '../../../targets/index.js';

// The producer supply scans: a worker fetches the recipe inputs its workplace is short on and hauls the
// finished output out, so the loop closes without a dedicated carrier. Every choice is recipe-driven and
// canonically scanned, so the winner never depends on store history.

/**
 * The recipes an operator's rotation would actually pick at `workplace`: its craftable products resolved
 * back to their per-product recipes, empty when it has earned none of them.
 */
export function operatorRecipes(
  world: World,
  ctx: SystemContext,
  workplace: Entity,
  operator: Entity,
): readonly Recipe[] {
  const recipes = recipesByProductOf(world, ctx, workplace);
  if (recipes === undefined) return [];
  const own: Recipe[] = [];
  for (const good of craftablePool(world, ctx, operator, recipes)) {
    const recipe = recipes.get(good);
    if (recipe !== undefined) own.push(recipe);
  }
  return own;
}

/**
 * How many work seats the workplace offers this tick: the cycles already grinding, each of which needs one
 * present operator to advance, plus the further cycles this operator's own recipes could start. The planner
 * hands out seats in canonical settler order, so a worker that finds them all taken is surplus and is freed
 * to fetch inputs or haul output instead of idling inside while a colleague's batch finishes.
 *
 * Approximation: the further-seat estimate is the max over the operator's pool, so two spare operators
 * whose pools name different startable products fill two seats where this counts one.
 */
export function workSeatCount(
  world: World,
  ctx: SystemContext,
  workplace: Entity,
  own: readonly Recipe[],
): number {
  const running = world.tryGet(workplace, Production)?.cycles.length ?? 0;
  const b = world.tryGet(workplace, Building);
  if (b === undefined || b.built < ONE) return running; // a construction site never starts a cycle
  let startable = 0;
  for (const recipe of own) {
    startable = Math.max(startable, startableCycleCount(world, ctx, workplace, recipe));
  }
  return running + startable;
}

/**
 * Where a producer worker should go for a missing recipe input, or null when every input is stocked and
 * nothing reachable can supply one. For the first input the workplace is short of it returns the nearest
 * source of either kind: a `fetch` from a store that holds the good, carrying exactly the shortfall, or a
 * `draw` from a built utility that mints the good from no inputs, cranked in place for one unit. Both kinds
 * compete in one canonical scan, so a bakery beside a well draws there rather than trek to a distant HQ
 * that also holds water. Source basis: authored.
 *
 * `restockToCapacity` raises each input's fetch target from the recipe amount to the workplace's declared
 * input-slot capacity, the bound carrier's shape (observed original behaviour). It does not affect a draw.
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
  /** The worker's owning player; it never fetches or draws from another player's store or utility. */
  owner: number | undefined,
  restockToCapacity = false,
  gate?: SpatialGate,
  /** The worker's failed-goal veto. */
  avoid?: (cell: NodeId) => boolean,
): MissingInputSource | null {
  const stock = world.get(workplace, Stockpile).amounts;
  const walls = buildingBlockedCells(world, ctx, terrain);
  for (const input of recipe.inputs) {
    const have = stock.get(input.goodType) ?? 0;
    const target = restockToCapacity ? stockCapacity(world, ctx, workplace, input.goodType) : input.amount;
    if (have >= target) continue;
    const winner = index.nearest<'fetch' | 'draw'>(
      here,
      (e) => {
        if (e === workplace || world.has(e, UnderConstruction)) return null;
        // A store that holds the good and may be stripped of it is a fetch; a buried pile is skipped,
        // since an unreachable stand strands the fetcher.
        if (
          (world.get(e, Stockpile).amounts.get(input.goodType) ?? 0) > 0 &&
          mayFetchGoodFrom(world, ctx, e, input.goodType)
        ) {
          return buriedUnderBuilding(world, terrain, walls, e) ? null : FETCH;
        }
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
      avoid,
      sameSideAs(world, owner),
    );
    if (winner === null) continue;
    return winner.payload === 'draw'
      ? { kind: 'draw', utility: winner.entity, goodType: input.goodType }
      : { kind: 'fetch', store: winner.entity, goodType: input.goodType, amount: target - have };
  }
  return null;
}

/**
 * The finished output a producer should haul out of its own workplace to clear room for the next cycle, or
 * null when it holds none another store can accept. Walked in `recipe.outputs` order, so the pick never
 * depends on store insertion history.
 */
export function workplaceOutputToHaul(
  deliverable: (goodType: number) => boolean,
  world: World,
  workplace: Entity,
  recipe: Recipe,
): number | null {
  const stock = world.get(workplace, Stockpile).amounts;
  for (const output of recipe.outputs) {
    if ((stock.get(output.goodType) ?? 0) <= 0) continue;
    // The routing itself excludes this producer as a sink.
    if (deliverable(output.goodType)) {
      return output.goodType;
    }
  }
  return null;
}
