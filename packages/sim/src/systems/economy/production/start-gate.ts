import type { Recipe } from '@open-northland/data';
import { Building, Owner, Production, Stockpile } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { technologyUnlockGeneration } from '../../progression/index.js';
import { livestockTribeOfGood } from '../../readviews/index.js';
import { anyCycleStartable } from './cycles.js';

/**
 * One {@link anyCycleStartable} answer and what it read besides content. The batches are held by product
 * rather than by revision, since running batches write their timers every tick.
 */
interface GateAnswer {
  readonly open: boolean;
  readonly stock: number | undefined;
  readonly batches: readonly number[];
  readonly building: number | undefined;
  readonly owner: number | undefined;
  readonly unlocks: number;
}

interface GateMemo {
  ctx: SystemContext;
  readonly answers: Map<Entity, GateAnswer>;
  /** The Building membership generation the answers were last pruned of razed workshops at. */
  buildings: number;
}

const memos = new WeakMap<World, GateMemo>();
const NO_BATCHES: readonly number[] = Object.freeze([]);

/**
 * {@link anyCycleStartable}, answered from memory while a workshop keeps the stock, batches, building,
 * owner and unlocks its last answer read. A tribe without a technology table and a breeding recipe read
 * state outside those (the alive trades, the herd), so they are always asked.
 */
export function cycleStartable(
  world: World,
  ctx: SystemContext,
  building: Entity,
  recipes: ReadonlyMap<number, Recipe>,
): boolean {
  if (!gateKeyable(world, ctx, building, recipes)) return anyCycleStartable(world, ctx, building, recipes);
  const memo = memoOf(world, ctx);
  const unlocks = technologyUnlockGeneration(world);
  const held = memo.answers.get(building);
  if (held !== undefined && answerCurrent(world, building, held, unlocks)) return held.open;
  const open = anyCycleStartable(world, ctx, building, recipes);
  memo.answers.set(building, {
    open,
    stock: world.revisionOf(building, Stockpile),
    batches: world.tryGet(building, Production)?.cycles.map((cycle) => cycle.goodType) ?? NO_BATCHES,
    building: world.revisionOf(building, Building),
    owner: world.revisionOf(building, Owner),
    unlocks,
  });
  return open;
}

/** Whether each recipe table breeds an animal, which reads the herd; content-keyed like the tables. */
const breedsByRecipes = new WeakMap<ReadonlyMap<number, Recipe>, boolean>();

function gateKeyable(
  world: World,
  ctx: SystemContext,
  building: Entity,
  recipes: ReadonlyMap<number, Recipe>,
): boolean {
  const tribe = world.get(building, Building).tribe;
  if (contentIndex(ctx.content).tribes.get(tribe)?.technology === undefined) return false;
  let breeds = breedsByRecipes.get(recipes);
  if (breeds === undefined) {
    breeds = [...recipes.values()].some((recipe) => {
      const product = recipe.outputs[0]?.goodType;
      return product !== undefined && livestockTribeOfGood(ctx.content, product) !== null;
    });
    breedsByRecipes.set(recipes, breeds);
  }
  return !breeds;
}

function answerCurrent(world: World, building: Entity, answer: GateAnswer, unlocks: number): boolean {
  if (
    answer.unlocks !== unlocks ||
    answer.stock !== world.revisionOf(building, Stockpile) ||
    answer.building !== world.revisionOf(building, Building) ||
    answer.owner !== world.revisionOf(building, Owner)
  )
    return false;
  const cycles = world.tryGet(building, Production)?.cycles;
  if ((cycles?.length ?? 0) !== answer.batches.length) return false;
  for (let i = 0; i < answer.batches.length; i++) {
    if (cycles?.[i]?.goodType !== answer.batches[i]) return false;
  }
  return true;
}

function memoOf(world: World, ctx: SystemContext): GateMemo {
  const buildings = world.componentGeneration(Building);
  let memo = memos.get(world);
  if (memo === undefined) {
    memo = { ctx, answers: new Map(), buildings };
    memos.set(world, memo);
    world.registerCacheVerifier('productionStartGate', () => verifyMemo(world));
  } else if (memo.ctx.content !== ctx.content) {
    memo.answers.clear();
  } else if (memo.buildings !== buildings) {
    for (const building of memo.answers.keys()) {
      if (!world.has(building, Building)) memo.answers.delete(building);
    }
  }
  memo.buildings = buildings;
  memo.ctx = ctx;
  return memo;
}

/** Every remembered answer whose inputs still match must equal a fresh one. */
function verifyMemo(world: World): string[] {
  const memo = memos.get(world);
  if (memo === undefined) return [];
  const unlocks = technologyUnlockGeneration(world);
  for (const [building, answer] of memo.answers) {
    if (!answerCurrent(world, building, answer, unlocks)) continue;
    const recipes = contentIndex(memo.ctx.content).recipeByProductByBuilding.get(
      world.get(building, Building).buildingType,
    );
    if (recipes !== undefined && anyCycleStartable(world, memo.ctx, building, recipes) !== answer.open) {
      return [`productionStartGate holds a stale answer for workshop ${building}`];
    }
  }
  return [];
}
