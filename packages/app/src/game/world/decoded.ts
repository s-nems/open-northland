import type { TerrainMapFile } from '@open-northland/data';
import type { Simulation, TerrainMap } from '@open-northland/sim';
import { diag } from '../../diag/index.js';
import { resolveWorldContent, type WorldContentOptions } from '../sandbox/index.js';
import { authoredCatalogExtras } from './authored-catalog.js';
import { type AuthoredJoinRows, resolveAuthoredPlacements } from './authored-placements.js';
import { enqueuePlacements, newWorldSim } from './build.js';

/**
 * A sim on a real decoded map with no placed entities - the map viewer's default for an imported map
 * that carries no authored `StaticObjects`. The map's own trees/ore/stone still spawn as harvestable
 * nodes afterwards; this exists purely so a plain imported map does not get the demo cluster dropped
 * onto its first walkable cells.
 *
 * Deterministic: seed-fixed, no RNG, no placements. Uses the same sandbox content + live `footprints`
 * the demo world's map path would, so a later interactive build behaves identically.
 */
export function runBareMap(seed: number, map: TerrainMap, options: WorldContentOptions = {}): Simulation {
  return newWorldSim(seed, map, resolveWorldContent(map, options));
}

/**
 * Build + run the sim for a map that carries authored entity placements (`map.cif` `StaticObjects` →
 * `maps/<id>.json` `entities`): every resolvable `sethouse` becomes a built building and every
 * `sethuman` a settler at its authored cell.
 *
 * The content is the sandbox content plus any extra authored type ids not in the sandbox catalog yet,
 * so authored maps do not shrink the build menu or profession rules. Returns `null` when nothing
 * resolves. Deterministic: placements enqueue in file order, no RNG.
 */
export function runAuthoredMap(
  seed: number,
  ticks: number,
  map: TerrainMap,
  entities: NonNullable<TerrainMapFile['entities']>,
  rows: AuthoredJoinRows,
  options: WorldContentOptions = {},
): Simulation | null {
  const { placements, skipped, droppedGoods, droppedPicks, skippedAnimals } = resolveAuthoredPlacements(
    entities,
    rows,
    map,
  );
  if (placements.length === 0) return null;
  if (skipped > 0 || droppedGoods > 0 || droppedPicks > 0 || skippedAnimals > 0) {
    diag.warn(
      'content',
      `runAuthoredMap: placed ${placements.length}, skipped ${skipped} unresolvable/out-of-bounds and ${skippedAnimals} unplaceable animals (unresolvable species or decorative swarms), dropped ${droppedGoods} unresolvable authored building goods and ${droppedPicks} unresolvable produced-good picks`,
    );
  }

  const content = resolveWorldContent(map, options, authoredCatalogExtras(placements, rows));
  const sim = newWorldSim(seed, map, content);
  enqueuePlacements(sim, placements);
  sim.run(ticks);
  return sim;
}
