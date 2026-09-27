import type { ContentSet } from '@open-northland/data';
import { Building, Position, Stockpile } from '../../../components/index.js';
import { JournaledCaptures } from '../../../ecs/journaled-captures.js';
import type { World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import { InteractionCellIndex } from './cell-index.js';

/**
 * Every `Stockpile + Position` entity's cell index, kept across ticks per world. A door moves only with a
 * `Building` write, and a stockpile changes node only by re-adding its `Position` (a vehicle's hold is
 * `VehicleStock`, not a stockpile), so the membership journals and the `Building` value journal name every
 * candidate whose key changed. The cache verifier is the tripwire should a stockpile ever move in place.
 */
class StockpileCells {
  readonly index: InteractionCellIndex;
  private readonly captures: JournaledCaptures<true>;

  constructor(
    world: World,
    readonly content: ContentSet,
    readonly terrain: TerrainGraph,
  ) {
    const index = new InteractionCellIndex(world, { content, terrain }, terrain);
    this.index = index;
    this.captures = new JournaledCaptures(
      world,
      { membership: [Stockpile, Position, Building], values: [Building] },
      () => world.canonicalQuery(Stockpile, Position),
      {
        capture: (e) => (world.has(e, Stockpile) && world.has(e, Position) ? true : null),
        apply: (e) => index.add(e),
        withdraw: (e) => index.remove(e),
        clear: () => index.clear(),
      },
    );
  }

  catchUp(): void {
    this.captures.catchUp();
  }
}

const ledgers = new WeakMap<World, StockpileCells>();

/** `world`'s stockpile cell index, caught up to its current stockpiles. */
export function stockpileCells(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
): InteractionCellIndex {
  let ledger = ledgers.get(world);
  if (ledger === undefined || ledger.content !== content || ledger.terrain !== terrain) {
    if (ledger === undefined) world.registerCacheVerifier('stockpileCells', () => verify(world));
    ledger = new StockpileCells(world, content, terrain);
    ledgers.set(world, ledger);
  } else {
    ledger.catchUp();
  }
  return ledger.index;
}

function verify(world: World): string[] {
  const ledger = ledgers.get(world);
  if (ledger === undefined) return [];
  ledger.catchUp();
  const { content, terrain } = ledger;
  const fresh = new InteractionCellIndex(
    world,
    { content, terrain },
    terrain,
    world.canonicalQuery(Stockpile, Position),
  );
  return ledger.index.divergence(fresh).map((m) => `stockpileCells: ${m}`);
}
