import { Position, RoadSite, UnderConstruction } from '../../../components/index.js';
import type { ChangeFeed, World } from '../../../ecs/world.js';
import type { TerrainGraph } from '../../../nav/terrain/index.js';
import type { MapContext } from '../../context.js';
import { InteractionCellIndex } from './cell-index.js';

interface HeldCells {
  readonly terrain: TerrainGraph;
  readonly feed: ChangeFeed;
  readonly cells: InteractionCellIndex;
}

const held = new WeakMap<World, HeldCells>();

/**
 * The road sites as a builder's site index, kept across ticks from a change feed, so a pass pays for the
 * sites ordered or laid since the last one rather than indexing every pending site again. A site never
 * moves. Derived read state, never hashed.
 */
export function roadSiteCells(world: World, ctx: MapContext, terrain: TerrainGraph): InteractionCellIndex {
  let entry = held.get(world);
  if (entry === undefined || entry.terrain !== terrain) {
    entry = {
      terrain,
      feed: world.watchChanges([RoadSite, UnderConstruction, Position], []),
      cells: freshCells(world, ctx, terrain),
    };
    held.set(world, entry);
    world.registerCacheVerifier('roadSiteCells', () => verify(world, ctx));
    return entry.cells;
  }
  const { cells, feed } = entry;
  const lost = feed.drain((e) => {
    cells.remove(e);
    if (world.has(e, RoadSite) && world.has(e, UnderConstruction) && world.has(e, Position)) cells.add(e);
  });
  if (lost) {
    cells.clear();
    for (const e of world.canonicalQuery(UnderConstruction, RoadSite, Position)) cells.add(e);
  }
  return cells;
}

function freshCells(world: World, ctx: MapContext, terrain: TerrainGraph): InteractionCellIndex {
  return new InteractionCellIndex(
    world,
    ctx,
    terrain,
    world.canonicalQuery(UnderConstruction, RoadSite, Position),
  );
}

function verify(world: World, ctx: MapContext): string[] {
  const entry = held.get(world);
  if (entry === undefined || entry.feed.pending) return [];
  return entry.cells.divergence(freshCells(world, ctx, entry.terrain)).map((m) => `roadSiteCells: ${m}`);
}
