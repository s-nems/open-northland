import type { Recipe } from '@open-northland/data';
import { MoveGoal, PathRequest, Stockpile } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { interactionNode } from '../../footprint/index.js';
import { operatorRecipeEnabled } from '../../progression/index.js';
import type { WorkshopWorkforce } from '../../stores/workshop-workforce.js';
import { cycleCoveredWith, outputRoomForCycles } from './cycles.js';
import { type CycleChoice, craftablePoolInto, lastStartOf, nextCycleFor } from './rotation.js';

const NO_RESERVATIONS: ReadonlyMap<number, number> = new Map();

/** The products one reservation pass has weighed, its head `selectedCount` entries; reused rather than
 *  emptied, since an emptied array drops its storage. The pass runs synchronously. */
const selectedScratch: number[] = [];
/** One crew member's craftable pool, read before the next member's overwrites it. */
const poolScratch: number[] = [];

/** Protect stocked ingredients from `asker` while an active crew member's other ingredients are arriving,
 * or while a crew member off the door has a costlier cycle to start. Recomputed after deliveries and each
 * start, so a returning operator cannot spend them first. Only a crew member that started its last batch
 * no later than `asker` holds them back, so each operator's turn comes round however its recipe compares
 * (authored). `present` are the operators on the door and `presentChoices` the spare ones' next cycles. */
export function incomingRecipeReservations(
  world: World,
  ctx: SystemContext,
  building: Entity,
  recipes: ReadonlyMap<number, Recipe>,
  workforce: WorkshopWorkforce,
  present: readonly Entity[],
  presentChoices: readonly (CycleChoice | undefined)[],
  asker: Entity,
): ReadonlyMap<number, number> {
  // Before this workshop's first start changes its stock.
  workforce.shelveInbound(building);
  const stock = world.get(building, Stockpile).amounts;
  const crew = workforce.operatorsAt(building);
  const askerStart = lastStartOf(world, asker);
  let reserved: Map<number, number> | undefined;
  const selected = selectedScratch;
  let selectedCount = 0;
  for (let c = 0; c < crew.length; c++) {
    const operator = crew[c] as Entity;
    if (lastStartOf(world, operator) > askerStart) continue;
    const size = craftablePoolInto(world, ctx, operator, recipes, poolScratch);
    for (let p = 0; p < size; p++) {
      const good = poolScratch[p] as number;
      if (weighed(selected, selectedCount, good)) continue;
      const recipe = recipes.get(good);
      if (recipe === undefined || !operatorRecipeEnabled(world, ctx, building, operator, recipe)) continue;
      selected[selectedCount++] = good;
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
  // The crew off the door (walking onto it, loitering, away): one whose next cycle needs more units than
  // any present operator's keeps all of its inputs, if it walks onto the door or stock and inbound units
  // cover that cycle; a member whose route failed keeps nothing. Authored arbitration, like the start order.
  let doorCell: NodeId | undefined | null = null;
  let inboundOf: ((good: number) => number) | undefined;
  for (let c = 0; c < crew.length; c++) {
    const operator = crew[c] as Entity;
    if (present.includes(operator) || world.tryGet(operator, PathRequest)?.failed === true) continue;
    if (lastStartOf(world, operator) > askerStart) continue;
    const choice = nextCycleFor(world, ctx, building, operator, recipes);
    if (choice === undefined || recipeInputUnits(choice.recipe) <= maxPresentUnits) continue;
    const goal = world.tryGet(operator, MoveGoal);
    if (goal !== undefined && doorCell === null) {
      const door = interactionNode(world, ctx, building);
      doorCell = door === null ? undefined : ctx.terrain?.nodeAt(door.x, door.y);
    }
    const arriving = goal !== undefined && doorCell !== undefined && goal.cell === doorCell;
    if (!arriving) {
      inboundOf ??= (good) => workforce.incomingOf(building, good);
      if (!cycleCoveredWith(world, building, choice.recipe, inboundOf)) continue;
    }
    for (let i = 0; i < choice.recipe.inputs.length; i++) {
      const input = choice.recipe.inputs[i];
      if (input === undefined) continue;
      reserved ??= new Map();
      reserved.set(input.goodType, Math.max(reserved.get(input.goodType) ?? 0, input.amount));
    }
  }
  return reserved ?? NO_RESERVATIONS;
}

function weighed(selected: readonly number[], count: number, good: number): boolean {
  for (let i = 0; i < count; i++) if (selected[i] === good) return true;
  return false;
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
