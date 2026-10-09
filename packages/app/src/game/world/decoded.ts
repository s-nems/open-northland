import type { Simulation, TerrainMap } from '@open-northland/sim';
import { diag } from '../../diag/index.js';
import { resolveWorldContent, type WorldContentOptions } from '../sandbox/index.js';
import { MAP_TRIBES, type SeatTribeRemap, seatedPlacements } from '../seat-tribes.js';
import { authoredCatalogExtras } from './authored-catalog.js';
import { type AuthoredEntities, resolveAuthoredPlacements } from './authored-placements.js';
import { enqueueFamilyLinks, enqueuePlacements, type MapScriptWorld, newWorldSim } from './build.js';
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
  absentSeats: readonly number[] = [],
  seatTribes: SeatTribeRemap = MAP_TRIBES,
): Simulation | null {
  const { placements, familyLinks, skipped, droppedGoods, droppedPicks, droppedAttachments, skippedAnimals } =
    resolveAuthoredPlacements(entities, rows, map, script);
  if (placements.length === 0) return null;
  if (skipped > 0 || droppedGoods > 0 || droppedPicks > 0 || droppedAttachments > 0 || skippedAnimals > 0) {
    diag.warn(
      'content',
      `runAuthoredMap: placed ${placements.length}, skipped ${skipped} unresolvable/out-of-bounds/duplicate-anchor records and ${skippedAnimals} unplaceable animals (unresolvable species or out of bounds), dropped ${droppedGoods} unresolvable authored building goods, ${droppedPicks} unresolvable produced-good picks and ${droppedAttachments} house attachments naming no placed building`,
    );
  }

  const content = resolveWorldContent(map, options, authoredCatalogExtras(placements, rows));
  const sim = newWorldSim(seed, map, content, script);
  // The catalog above still counts an absent seat's placements, so a restore resolves the same content
  // without knowing the roster.
  const absent = new Set(absentSeats);
  // Like the absent seats, a changed seat's tribes stay out of the catalog, which a restore resolves
  // without the session.
  enqueuePlacements(
    sim,
    seatedPlacements(
      placements.filter((p) => p.owner === undefined || !absent.has(p.owner)),
      seatTribes,
    ),
  );
  enqueueFamilyLinks(sim, familyLinks);
  sim.run(ticks);
  return sim;
}
