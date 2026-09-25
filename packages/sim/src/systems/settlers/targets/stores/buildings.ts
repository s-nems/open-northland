import { PRAYER_SITE } from '@open-northland/data';
import { ownerOf, ownersCompatible, sameSideAs } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import { hexDistanceBetween } from '../../../../nav/halfcell.js';
import type { SpatialGate } from '../../../../nav/node-circle.js';
import type { NodeId, TerrainGraph } from '../../../../nav/terrain/index.js';
import { constructionTribeOf } from '../../../stores/index.js';
import type { TargetBands } from '../bands.js';
import { ACCEPT_ALL, type InteractionCellIndex, QUALIFIES } from '../cell-index.js';

/** Map points within which the nearest temple is taken outright; a farther one competes with the
 *  headquarters, and the nearer of the two wins, a tie going to the headquarters. Original behavior. */
export const TEMPLE_PREFERRED_RANGE = 40;

/**
 * Where a devout settler with no holy fire at home walks to pray: the nearest of its player's finished
 * temples, unless it lies beyond {@link TEMPLE_PREFERRED_RANGE} and a headquarters is no farther. The
 * candidates are ranked by this index's Manhattan distance with the shared ascending-cell-id tie-break and
 * compared in map points, an approximation of the original's hex-distance search on the settler's own
 * continent. Null when neither is found. `gate` is the settler's signpost confinement: a site outside its
 * allowed area is not one it knows the way to.
 */
export function nearestPrayerSite(
  bands: TargetBands,
  world: World,
  terrain: TerrainGraph,
  here: NodeId,
  /** The settler's owning player. A settler prays only at its own player's sites. */
  owner: number | undefined,
  gate?: SpatialGate,
  /** The settler's failed-goal veto. */
  avoid?: (cell: NodeId) => boolean,
): Entity | null {
  const onSide = sameSideAs(world, owner);
  const temple = bands.prayerSites(PRAYER_SITE.temple).nearest(here, ACCEPT_ALL, gate, avoid, onSide);
  const templePoints =
    temple === null ? Number.POSITIVE_INFINITY : mapPointsBetween(terrain, here, temple.cell);
  if (temple !== null && templePoints <= TEMPLE_PREFERRED_RANGE) return temple.entity;
  const headquarters = bands
    .prayerSites(PRAYER_SITE.headquarters)
    .nearest(here, ACCEPT_ALL, gate, avoid, onSide);
  if (headquarters !== null && mapPointsBetween(terrain, here, headquarters.cell) <= templePoints) {
    return headquarters.entity;
  }
  return temple?.entity ?? null;
}

function mapPointsBetween(terrain: TerrainGraph, a: NodeId, b: NodeId): number {
  const from = terrain.coordsOf(a);
  const to = terrain.coordsOf(b);
  return hexDistanceBetween(from.x, from.y, to.x, to.y);
}

/**
 * The nearest site in `index` a builder of `tribe` should work - a foundation to raise or a damaged
 * building to mend - by Manhattan distance from `here` with the shared ascending-cell-id tie-break, or
 * null when the side has none. A builder works only its own player's sites, since two players may field
 * the same tribe.
 */
export function nearestBuilderSite(
  index: InteractionCellIndex,
  world: World,
  here: NodeId,
  tribe: number,
  owner: number | undefined,
  gate?: SpatialGate,
  /** The builder's failed-goal veto at the site's perimeter stand. */
  avoidSite?: (site: Entity) => boolean,
  /** Additional side-effect-free task qualification for builder allocation. */
  acceptsSite: (site: Entity) => boolean = () => true,
): Entity | null {
  // `gate` is the builder's signpost confinement: a site outside its allowed area is left unbuilt.
  return (
    index.nearest(
      here,
      (e) =>
        constructionTribeOf(world, e) === tribe &&
        ownersCompatible(owner, ownerOf(world, e)) &&
        avoidSite?.(e) !== true &&
        acceptsSite(e)
          ? QUALIFIES
          : null,
      gate,
    )?.entity ?? null
  );
}
