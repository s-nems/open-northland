import type { Recipe } from '@open-northland/data';
import { Building, MoveGoal, ownerOf, PathRequest, Stockpile } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { interactionNode } from '../../footprint/index.js';
import { recipeOutputsEnabled } from '../../progression/index.js';
import type { WorkshopWorkforce } from '../../stores/workshop-workforce.js';
import { outputRoomForCycles } from './cycles.js';
import { craftablePool, nextCycleFor } from './rotation.js';

/** Protect stocked ingredients while an active crew member's other ingredients are arriving.
 * Recomputed after deliveries and each start, so a returning operator cannot spend them first. */
export function incomingRecipeReservations(
  world: World,
  ctx: SystemContext,
  building: Entity,
  recipes: ReadonlyMap<number, Recipe>,
  workforce: WorkshopWorkforce,
  present: readonly Entity[],
): ReadonlyMap<number, number> {
  const stock = world.get(building, Stockpile).amounts;
  const owner = ownerOf(world, building);
  const tribe = world.get(building, Building).tribe;
  const selected = new Set<number>();
  for (const operator of workforce.operatorsAt(building)) {
    for (const good of craftablePool(world, ctx, operator, recipes)) selected.add(good);
  }
  const reserved = new Map<number, number>();
  for (const good of selected) {
    const recipe = recipes.get(good);
    if (recipe === undefined || !recipeOutputsEnabled(world, ctx, owner, tribe, recipe)) continue;
    if (outputRoomForCycles(world, ctx, building, recipe) <= 0) continue;
    if (
      !recipe.inputs.some(
        (input) =>
          (stock.get(input.goodType) ?? 0) < input.amount &&
          workforce.incomingOf(building, input.goodType) > 0,
      )
    )
      continue;
    for (const input of recipe.inputs) {
      const held = Math.min(stock.get(input.goodType) ?? 0, input.amount);
      if (held > 0) reserved.set(input.goodType, Math.max(reserved.get(input.goodType) ?? 0, held));
    }
  }
  const nextPresent = present.map((operator) => nextCycleFor(world, ctx, building, operator, recipes));
  const unitsOf = (recipe: Recipe): number => recipe.inputs.reduce((sum, input) => sum + input.amount, 0);
  const maxPresentUnits = Math.max(
    0,
    ...nextPresent.map((choice) => (choice === undefined ? 0 : unitsOf(choice.recipe))),
  );
  const door = interactionNode(world, ctx, building);
  const doorCell = door === null ? undefined : ctx.terrain?.nodeAt(door.x, door.y);
  if (doorCell !== undefined)
    for (const operator of workforce.operatorsAt(building)) {
      if (
        world.tryGet(operator, MoveGoal)?.cell !== doorCell ||
        world.tryGet(operator, PathRequest)?.failed === true
      )
        continue;
      const choice = nextCycleFor(world, ctx, building, operator, recipes);
      if (choice === undefined || unitsOf(choice.recipe) <= maxPresentUnits) continue;
      for (const input of choice.recipe.inputs)
        reserved.set(input.goodType, Math.max(reserved.get(input.goodType) ?? 0, input.amount));
    }
  return reserved;
}
