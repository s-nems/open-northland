import type { Simulation } from '../simulation.js';
import { foodSourcesOf } from '../systems/family/food-sources.js';
import { qualitySources } from '../systems/family/quality-search.js';
import { resourceAtTile } from '../systems/footprint/resource-tile-cache.js';
import { unitWalkBlocks } from '../systems/movement/collision/standing-posts.js';
import { stockpileCells } from '../systems/settlers/targets/stockpile-cells.js';
import { FetchableStock } from '../systems/settlers/targets/stores/fetchable-stock.js';
import { StoreSinks } from '../systems/settlers/targets/stores/sinks.js';
import { yardOccupancy } from '../systems/settlers/targets/yard-occupancy.js';
import { warmPostReaches } from '../systems/signposts/index.js';
import { resourceHarvestAtomics } from '../systems/spatial/resources.js';
import { stockpilesAtNode } from '../systems/spatial/stockpiles.js';

/**
 * Build a restored world's derived indexes inside the load pause, ahead of the first tick whose first
 * reader would otherwise build each one mid-tick. Each is a pure function of the world that later reads
 * catch up through its change journals, so no answer or state hash moves; `npm run bench:parity`
 * checks that against the continuous run. The answers read here are discarded.
 */
export function warmRestoredWorld(sim: Simulation): void {
  const { world, content, terrain } = sim;
  const ctx = { content };
  StoreSinks.of(world, ctx);
  FetchableStock.of(world, ctx);
  foodSourcesOf(world, content);
  qualitySources(world, content);
  resourceHarvestAtomics(world);
  resourceAtTile(world, 0, 0, 0);
  stockpilesAtNode(world, 0, 0);
  if (terrain === undefined) return;
  warmPostReaches(world, content, terrain);
  unitWalkBlocks(world, content, terrain);
  yardOccupancy(world, terrain);
  stockpileCells(world, content, terrain);
}
