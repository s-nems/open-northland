import type { ContentSet } from '@open-northland/data';
import {
  BerryBush,
  Building,
  Position,
  Stockpile,
  UnderConstruction,
  Upgrading,
} from '../../../components/index.js';
import { JournaledCaptures } from '../../../ecs/journaled-captures.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { isEdibleFoodIn } from '../../readviews/index.js';
import { accessibleStockAmounts } from '../../stores/index.js';
import { InteractionCellIndex } from './cell-index.js';

/** Whether `e` is a potential meal: a store a fetcher can take an edible unit off, or a ripe bush. Which
 *  unit an eater may take, past recipe inputs, storage minimums and claims, is read live by the eater. */
function isPotentialMeal(world: World, content: ContentSet, e: Entity): boolean {
  if (!world.has(e, Position)) return false;
  if (world.tryGet(e, BerryBush)?.stage === 'ripe') return true;
  if (!world.has(e, Stockpile)) return false;
  const amounts = accessibleStockAmounts(world, e);
  if (amounts === undefined) return false;
  // Indexed by key: destructured entries would allocate per good on the capture path.
  for (const goodType of amounts.keys()) {
    if ((amounts.get(goodType) ?? 0) > 0 && isEdibleFoodIn(content, goodType)) return true;
  }
  return false;
}

/** The potential meals. The two memberships can overlap, so yield each entity once. Index insertion owns
 *  tie ordering. */
function* candidates(world: World, content: ContentSet): Iterable<Entity> {
  for (const e of world.canonicalQuery(Stockpile, Position)) {
    if (isPotentialMeal(world, content, e)) yield e;
  }
  for (const e of world.canonicalQuery(BerryBush, Position)) {
    if (!world.has(e, Stockpile) && isPotentialMeal(world, content, e)) yield e;
  }
}

/** A shared meal index, updated by membership, stock and building changes rather than rebuilt per eater.
 *  A bare bush and a store without an edible unit stay out of it, so a search for food scans neither
 *  the bushes nor the piles of other goods. Caught up on every read, since a meal eaten earlier in a pass
 *  may empty a store. Like stockpileCells, relocating a source replaces its Position rather than mutating
 *  it in place. */
class MealCells {
  readonly index: InteractionCellIndex;
  readonly captures: JournaledCaptures<true>;

  constructor(
    world: World,
    readonly content: ContentSet,
    readonly terrain: TerrainGraph,
  ) {
    const index = new InteractionCellIndex(world, { content, terrain }, terrain);
    this.index = index;
    this.captures = new JournaledCaptures(
      world,
      {
        membership: [Stockpile, BerryBush, Position, Building, Upgrading, UnderConstruction],
        values: [Building, BerryBush, Stockpile, Upgrading],
      },
      () => candidates(world, content),
      {
        capture: (e) => (isPotentialMeal(world, content, e) ? true : null),
        apply: (e) => index.add(e),
        withdraw: (e) => index.remove(e),
        clear: () => index.clear(),
      },
    );
  }
}

const ledgers = new WeakMap<World, MealCells>();

/** Every potential meal in one spatial index, caught up lazily when the planner needs food. */
export function mealCells(world: World, content: ContentSet, terrain: TerrainGraph): InteractionCellIndex {
  let ledger = ledgers.get(world);
  if (ledger === undefined || ledger.content !== content || ledger.terrain !== terrain) {
    if (ledger === undefined) world.registerCacheVerifier('mealCells', () => verify(world));
    ledger = new MealCells(world, content, terrain);
    ledgers.set(world, ledger);
  } else {
    ledger.captures.catchUp();
  }
  return ledger.index;
}

function verify(world: World): string[] {
  const ledger = ledgers.get(world);
  if (ledger === undefined) return [];
  ledger.captures.catchUp();
  const { content, terrain } = ledger;
  const fresh = new InteractionCellIndex(world, { content, terrain }, terrain, [
    ...candidates(world, content),
  ]);
  return ledger.index.divergence(fresh).map((m) => `mealCells: ${m}`);
}
