import type { Simulation } from '../simulation.js';
import { foodSourcesOf } from '../systems/family/food-sources.js';
import { qualitySources } from '../systems/family/quality-search.js';
import { workFlagPlacementBlocks } from '../systems/footprint/index.js';
import { placementBlockerGrid } from '../systems/footprint/placement/blocker-grid.js';
import { vehicleClearance } from '../systems/footprint/vehicle-clearance.js';
import { unitWalkBlocks } from '../systems/movement/collision/standing-posts.js';
import { constructionSiteCells } from '../systems/settlers/targets/construction-site-cells.js';
import { cropsByFarm } from '../systems/settlers/targets/crops-by-farm.js';
import { harvesterMarks } from '../systems/settlers/targets/harvester-marks.js';
import { mealCells } from '../systems/settlers/targets/meal-cells.js';
import { stockpileCells } from '../systems/settlers/targets/stockpile-cells.js';
import { FetchableStock } from '../systems/settlers/targets/stores/fetchable-stock.js';
import { StoreSinks } from '../systems/settlers/targets/stores/sinks.js';
import { yardOccupancy } from '../systems/settlers/targets/yard-occupancy.js';
import { warmPostReaches } from '../systems/signposts/index.js';
import { resourceHarvestAtomics, resourceOfGoodAtNode } from '../systems/spatial/resources.js';
import { stockpilesAtNode } from '../systems/spatial/stockpiles.js';

/**
 * Build a loaded or freshly assembled world's derived indexes inside the load pause, ahead of the first
 * tick whose first reader would otherwise build each one mid-tick. A map world spawns its objects outside
 * any tick, more of them than the change journals keep, so it needs this as much as a restore. Each is a
 * pure function of the world that later reads catch up through its change journals, so no answer or state
 * hash moves; `npm run bench:parity` checks that against the continuous run. The answers read here are
 * discarded.
 */
export function warmWorldIndexes(sim: Simulation): void {
  const { world, content, terrain } = sim;
  const ctx = { content };
  StoreSinks.of(world, ctx);
  FetchableStock.of(world, ctx);
  foodSourcesOf(world, content);
  qualitySources(world, content);
  resourceHarvestAtomics(world);
  resourceOfGoodAtNode(world, 0, 0, 0);
  stockpilesAtNode(world, 0, 0);
  cropsByFarm(world);
  harvesterMarks(world);
  if (terrain === undefined) return;
  warmPostReaches(world, content, terrain);
  unitWalkBlocks(world, content, terrain);
  yardOccupancy(world, terrain);
  stockpileCells(world, content, terrain);
  constructionSiteCells(world, content, terrain);
  mealCells(world, content, terrain);
  // The first vehicle site a yard worker looks for reads the free-size classes of the whole map.
  vehicleClearance(world, ctx, terrain);
  // The first building placed after a load reads both blocker sets, each a stamp of every blocker.
  placementBlockerGrid(world, content, terrain);
  workFlagPlacementBlocks(world, content, terrain);
}
