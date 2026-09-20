import { Building, ownerOf, ownersCompatible, sameSideAs } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { SpatialGate } from '../../../../nav/node-circle.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import type { TargetBands } from '../bands.js';
import { ACCEPT_ALL, type InteractionCellIndex, QUALIFIES } from '../cell-index.js';

/**
 * The nearest temple a devout settler should walk to in order to pray, by Manhattan distance from
 * `here` with the shared ascending-cell-id tie-break, or null when the player has none. `gate` is the
 * settler's signpost confinement: a temple outside its allowed area is not one it knows the way to.
 */
export function nearestTemple(
  bands: TargetBands,
  world: World,
  here: NodeId,
  /** The settler's owning player. A settler prays only in its own player's temple. */
  owner: number | undefined,
  gate?: SpatialGate,
  /** The settler's failed-goal veto. */
  avoid?: (cell: NodeId) => boolean,
): Entity | null {
  return bands.temples().nearest(here, ACCEPT_ALL, gate, avoid, sameSideAs(world, owner))?.entity ?? null;
}

/**
 * The nearest construction site a builder of `tribe` should raise, by Manhattan distance from `here`
 * with the shared ascending-cell-id tie-break, or null when the side has none. A builder raises only its
 * own player's foundations, since two players may field the same tribe.
 */
export function nearestConstructionSite(
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
