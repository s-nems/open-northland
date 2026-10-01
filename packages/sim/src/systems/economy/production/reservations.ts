import type { Recipe } from '@open-northland/data';
import { MoveGoal, PathRequest, Stockpile } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { interactionNode } from '../../footprint/index.js';
import { operatorRecipeEnabled } from '../../progression/index.js';
import type { WorkshopWorkforce } from '../../stores/workshop-workforce.js';
import { outputRoomForCycles } from './cycles.js';
import { type CycleChoice, craftablePool, nextCycleFor } from './rotation.js';

const NO_RESERVATIONS: ReadonlyMap<number, number> = new Map();

/** Protect stocked ingredients while an active crew member's other ingredients are arriving.
 * Recomputed after deliveries and each start, so a returning operator cannot spend them first.
 * `presentChoices` are the present operators' next cycles. */
export function incomingRecipeReservations(
  world: World,
  ctx: SystemContext,
  building: Entity,
  recipes: ReadonlyMap<number, Recipe>,
  workforce: WorkshopWorkforce,
  presentChoices: readonly (CycleChoice | undefined)[],
): ReadonlyMap<number, number> {
  // Before this workshop's first start changes its stock.
  workforce.shelveInbound(building);
  const stock = world.get(building, Stockpile).amounts;
  const crew = workforce.operatorsAt(building);
  let reserved: Map<number, number> | undefined;
  const selected: number[] = [];
  for (let c = 0; c < crew.length; c++) {
    const operator = crew[c] as Entity;
    const pool = craftablePool(world, ctx, operator, recipes);
    for (let p = 0; p < pool.length; p++) {
      const good = pool[p] as number;
      if (selected.includes(good)) continue;
      const recipe = recipes.get(good);
      if (recipe === undefined || !operatorRecipeEnabled(world, ctx, building, operator, recipe)) continue;
      selected.push(good);
      if (outputRoomForCycles(world, ctx, building, recipe) <= 0) continue;
      if (!awaitsInbound(stock, recipe, workforce, building)) continue;
      for (let i = 0; i < recipe.inputs.length; i++) {
        const input = recipe.inputs[i];
        if (input === undefined) continue;
        const held = Math.min(stock.get(input.goodType) ?? 0, input.amount);
        if (held <= 0) continue;
        reserved ??= new Map();
        reserved.set(input.goodType, Math.max(reserved.get(input.goodType) ?? 0, held));
      }
    }
  }
  let maxPresentUnits = 0;
  for (let i = 0; i < presentChoices.length; i++) {
    const choice = presentChoices[i];
    if (choice !== undefined) maxPresentUnits = Math.max(maxPresentUnits, recipeInputUnits(choice.recipe));
  }
  // The operators walking onto the door: one whose next cycle needs more units than any present
  // operator's keeps all of its inputs.
  let doorCell: NodeId | undefined | null = null;
  for (let c = 0; c < crew.length; c++) {
    const operator = crew[c] as Entity;
    const goal = world.tryGet(operator, MoveGoal);
    if (goal === undefined) continue;
    if (doorCell === null) {
      const door = interactionNode(world, ctx, building);
      doorCell = door === null ? undefined : ctx.terrain?.nodeAt(door.x, door.y);
    }
    if (doorCell === undefined) break;
    if (goal.cell !== doorCell || world.tryGet(operator, PathRequest)?.failed === true) continue;
    const choice = nextCycleFor(world, ctx, building, operator, recipes);
    if (choice === undefined || recipeInputUnits(choice.recipe) <= maxPresentUnits) continue;
    for (let i = 0; i < choice.recipe.inputs.length; i++) {
      const input = choice.recipe.inputs[i];
      if (input === undefined) continue;
      reserved ??= new Map();
      reserved.set(input.goodType, Math.max(reserved.get(input.goodType) ?? 0, input.amount));
    }
  }
  return reserved ?? NO_RESERVATIONS;
}

/** Whether an input the workshop stocks short of the recipe amount has units on their way. */
function awaitsInbound(
  stock: ReadonlyMap<number, number>,
  recipe: Recipe,
  workforce: WorkshopWorkforce,
  building: Entity,
): boolean {
  for (let i = 0; i < recipe.inputs.length; i++) {
    const input = recipe.inputs[i];
    if (input === undefined) continue;
    if (
      (stock.get(input.goodType) ?? 0) < input.amount &&
      workforce.incomingOf(building, input.goodType) > 0
    ) {
      return true;
    }
  }
  return false;
}

/** The input units one cycle of `recipe` consumes. */
export function recipeInputUnits(recipe: Recipe): number {
  let units = 0;
  for (let i = 0; i < recipe.inputs.length; i++) units += recipe.inputs[i]?.amount ?? 0;
  return units;
}
