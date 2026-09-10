import type { Simulation, TerrainMap } from '@open-northland/sim';
import { diag } from '../../diag/index.js';
import { resolveWorldContent, type WorldContentOptions } from '../sandbox/index.js';
import { authoredCatalogExtras } from './authored-catalog.js';
import { type AuthoredEntities, resolveAuthoredPlacements } from './authored-placements.js';
import { enqueuePlacements, type MapScriptWorld, newWorldSim } from './build.js';
import type { AuthoredJoinRows } from './content-joins.js';

/**
 * A sim on a real decoded map with no placed entities, for an imported map carrying no authored
 * `StaticObjects`. Its own trees, ore and stone still spawn as harvestable nodes afterwards; this
 * exists so a plain imported map does not get the demo cluster dropped onto its first walkable cells.
 */
export function runBareMap(
  seed: number,
  map: TerrainMap,
  options: WorldContentOptions = {},
  script: MapScriptWorld = {},
): Simulation {
  return newWorldSim(seed, map, resolveWorldContent(map, options), script);
}

/**
 * Build and run the sim for a map carrying authored entity placements: every resolvable `sethouse`
 * becomes a built building and every `sethuman` a settler at its authored cell. The content is the
 * sandbox content plus any authored type ids missing from it, so an authored map never shrinks the
 * build menu. Returns `null` when nothing resolves.
 */
export function runAuthoredMap(
  seed: number,
  ticks: number,
  map: TerrainMap,
  entities: AuthoredEntities,
  rows: AuthoredJoinRows,
  options: WorldContentOptions = {},
  script: MapScriptWorld = {},
): Simulation | null {
  const { placements, skipped, droppedGoods, droppedPicks, droppedAttachments, skippedAnimals } =
    resolveAuthoredPlacements(entities, rows, map, script.humanNames);
  if (placements.length === 0) return null;
  if (skipped > 0 || droppedGoods > 0 || droppedPicks > 0 || droppedAttachments > 0 || skippedAnimals > 0) {
    diag.warn(
      'content',
      `runAuthoredMap: placed ${placements.length}, skipped ${skipped} unresolvable/out-of-bounds and ${skippedAnimals} unplaceable animals (unresolvable species or decorative swarms), dropped ${droppedGoods} unresolvable authored building goods, ${droppedPicks} unresolvable produced-good picks and ${droppedAttachments} house attachments naming no placed building`,
    );
  }

  const content = resolveWorldContent(map, options, authoredCatalogExtras(placements, rows));
  const sim = newWorldSim(seed, map, content, script);
  enqueuePlacements(sim, placements);
  sim.run(ticks);
  return sim;
}
