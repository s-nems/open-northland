import { PRAYER_SITE } from '@open-northland/data';
import { Building, ownerOf, ownersCompatible, sameSideAs } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SpatialGate } from '../../../../nav/node-circle.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import type { TargetBands } from '../bands.js';
import { ACCEPT_ALL, type InteractionCellIndex, QUALIFIES } from '../cell-index.js';

/**
 * Where a devout settler with no holy fire at home walks to pray: the nearest of its player's finished
 * temples, and only when it has none in reach, the nearest of its headquarters. Original behavior for the
 * order; the ranking is this index's Manhattan distance with the shared ascending-cell-id tie-break, an
 * approximation of the original's hex distance on the settler's own continent. Null when neither is found.
 * `gate` is the settler's signpost confinement: a site outside its allowed area is not one it knows the way
 * to.
 */
export function nearestPrayerSite(
  bands: TargetBands,
  world: World,
  here: NodeId,
  /** The settler's owning player. A settler prays only at its own player's sites. */
  owner: number | undefined,
  gate?: SpatialGate,
  /** The settler's failed-goal veto. */
  avoid?: (cell: NodeId) => boolean,
): Entity | null {
  const onSide = sameSideAs(world, owner);
  for (const site of PRAYER_SITES_IN_ORDER) {
    const found = bands.prayerSites(site).nearest(here, ACCEPT_ALL, gate, avoid, onSide);
    if (found !== null) return found.entity;
  }
  return null;
}

const PRAYER_SITES_IN_ORDER = [PRAYER_SITE.temple, PRAYER_SITE.headquarters] as const;

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
        world.get(e, Building).tribe === tribe &&
        ownersCompatible(owner, ownerOf(world, e)) &&
        avoidSite?.(e) !== true &&
        acceptsSite(e)
          ? QUALIFIES
          : null,
      gate,
    )?.entity ?? null
  );
}
