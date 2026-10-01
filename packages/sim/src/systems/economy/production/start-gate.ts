import type { Recipe } from '@open-northland/data';
import { Building, Owner, Production, Settler, Stockpile } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { technologyUnlockGeneration } from '../../progression/index.js';
import { livestockTribeOfGood } from '../../readviews/index.js';
import { assignedWorkers } from '../../stores/assigned-workers.js';
import { anyCycleStartable } from './cycles.js';

/**
 * One {@link anyCycleStartable} answer and what it read besides content, rewritten in place when the
 * workshop's answer is retaken. The batches are held by product rather than by revision, since running
 * batches write their timers every tick.
 */
interface GateAnswer {
  open: boolean;
  stock: number | undefined;
  readonly batches: number[];
  building: number | undefined;
  owner: number | undefined;
  unlocks: number;
  /** The bound workers' tribes in ascending worker id: the recipe gate reads them, not the house's. */
  readonly crew: (number | undefined)[];
}

interface GateMemo {
  ctx: SystemContext;
  readonly answers: Map<Entity, GateAnswer>;
  /** The Building membership generation the answers were last pruned of razed workshops at. */
  buildings: number;
}

const memos = new WeakMap<World, GateMemo>();
const NO_CYCLES: readonly { readonly goodType: number }[] = [];

/**
 * {@link anyCycleStartable}, answered from memory while a workshop keeps the stock, batches, building,
 * owner, crew tribes and unlocks its last answer read. A tribe without a technology table and a breeding
 * recipe read state outside those (the alive trades, the herd), so they are always asked.
 */
export function cycleStartable(
  world: World,
  ctx: SystemContext,
  building: Entity,
  recipes: ReadonlyMap<number, Recipe>,
): boolean {
  const memo = memoOf(world, ctx);
  const unlocks = technologyUnlockGeneration(world);
  const held = memo.answers.get(building);
  // Only a keyable gate is remembered, and its answer keys on everything keyability reads (the crew
  // tribes, the house through its revision, and the recipes through its type).
  if (held !== undefined && answerCurrent(world, building, held, unlocks)) return held.open;
  if (!gateKeyable(world, ctx, building, recipes)) return anyCycleStartable(world, ctx, building, recipes);
  const open = anyCycleStartable(world, ctx, building, recipes);
  const answer = held ?? {
    open,
    stock: undefined,
    batches: [],
    building: undefined,
    owner: undefined,
    unlocks,
    crew: [],
  };
  answer.open = open;
  answer.stock = world.revisionOf(building, Stockpile);
  answer.building = world.revisionOf(building, Building);
  answer.owner = world.revisionOf(building, Owner);
  answer.unlocks = unlocks;
  const cycles = world.tryGet(building, Production)?.cycles;
  answer.batches.length = 0;
  for (const cycle of cycles ?? NO_CYCLES) answer.batches.push(cycle.goodType);
  answer.crew.length = 0;
  for (const worker of assignedWorkers(world, building)) answer.crew.push(crewTribe(world, worker));
  if (held === undefined) memo.answers.set(building, answer);
  return open;
}

/** Whether each recipe table breeds an animal, which reads the herd; content-keyed like the tables. */
const breedsByRecipes = new WeakMap<ReadonlyMap<number, Recipe>, boolean>();

/** A bound worker's tribe, or none for a binding that outlived its settler. */
function crewTribe(world: World, worker: Entity): number | undefined {
  return world.tryGet(worker, Settler)?.tribe;
}

/** Whether every tribe the recipe gate may read has a technology table: the crew's, or the house's
 *  while nobody is bound. */
function tribesTabled(world: World, ctx: SystemContext, building: Entity): boolean {
  const tribes = contentIndex(ctx.content).tribes;
  const workers = assignedWorkers(world, building);
  if (workers.length === 0) {
    return tribes.get(world.get(building, Building).tribe)?.technology !== undefined;
  }
  for (const worker of workers) {
    const tribe = crewTribe(world, worker);
    if (tribe !== undefined && tribes.get(tribe)?.technology === undefined) return false;
  }
  return true;
}

function gateKeyable(
  world: World,
  ctx: SystemContext,
  building: Entity,
  recipes: ReadonlyMap<number, Recipe>,
): boolean {
  if (!tribesTabled(world, ctx, building)) return false;
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
  const workers = assignedWorkers(world, building);
  if (workers.length !== answer.crew.length) return false;
  for (let i = 0; i < workers.length; i++) {
    const worker = workers[i];
    if (worker === undefined || crewTribe(world, worker) !== answer.crew[i]) return false;
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
