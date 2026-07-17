import { Building, ownerOf, ownersCompatible } from '../../../../components/index.js';
import type { Entity, World } from '../../../../ecs/world.js';
import type { NodeId } from '../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../context.js';
import type { SpatialGate } from '../../../node-metric.js';
import { isTemple } from '../../../stores/index.js';
import { type InteractionCellIndex, QUALIFIES } from '../cell-index.js';

/**
 * The nearest {@link isTemple temple} a devout settler should walk to in order to pray, by Manhattan
 * distance from `here` with the shared ascending-cell-id tie-break. Returns the temple entity or null
 * if no temple exists — the piety need's satisfier→building-target lookup (eat resolves to a store,
 * sleep to no site; pray resolves to a specific building the settler must reach). `gate` is the
 * settler's signpost confinement — a temple outside its allowed area is not one it knows the way to.
 */
export function nearestTemple(
  index: InteractionCellIndex,
  world: World,
  ctx: SystemContext,
  here: NodeId,
  gate?: SpatialGate,
): Entity | null {
  // buildingCells holds only Building + Position candidates, so only the temple filter remains.
  return index.nearest(here, (e) => (isTemple(world, ctx, e) ? QUALIFIES : null), gate)?.entity ?? null;
}

/**
 * The nearest **construction site** a builder of `tribe` should raise — a {@link Building} still marked
 * {@link UnderConstruction} (a placed foundation being built up), by Manhattan distance from `here` with
 * the shared ascending-cell-id tie-break. Returns the site entity or null if the side has no site under
 * construction. Scans the construction-site index, so with no foundations in progress the search finds
 * nothing however many finished buildings stand. `owner` is the builder's owning player ({@link ownerOf})
 * — a builder raises only ITS OWN player's foundations (two same-tribe players must not build each other's).
 */
export function nearestConstructionSite(
  index: InteractionCellIndex,
  world: World,
  here: NodeId,
  tribe: number,
  owner: number | undefined,
  gate?: SpatialGate,
): Entity | null {
  // The index holds only UnderConstruction + Building + Position sites, so just the side filters remain.
  // `gate` is the builder's signpost confinement: a site outside its allowed area is left unbuilt.
  return (
    index.nearest(
      here,
      (e) =>
        world.get(e, Building).tribe === tribe && ownersCompatible(owner, ownerOf(world, e))
          ? QUALIFIES
          : null,
      gate,
    )?.entity ?? null
  );
}
