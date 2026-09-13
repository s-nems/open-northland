import { type BuildingFootprint, firstByTypeId, footprintCellDx } from '@open-northland/data';
import { entityById, nodeOfPosition, type SimEvent, type WorldSnapshot } from '@open-northland/sim';
import { forEachPlacement } from '../content/map-placements.js';
import { buildingTypeOf, isBuilding, positionOf, type SnapshotEntity } from '../game/snapshot.js';
import type { StaticDrawSurface } from './harvestable-handover.js';

/** The slice of a building type the clearing reads: its walk-block cells. */
export interface FootprintBuildingType {
  readonly typeId: number;
  readonly footprint?: Pick<BuildingFootprint, 'blocked'> | undefined;
}

function nodeKey(hx: number, hy: number): string {
  return `${hx},${hy}`;
}

/**
 * A building's walk-block footprint is bare ground: the static sprites on it leave the layer when the
 * building is placed or upgraded, and at bind for every building already standing (the original
 * symbols: a house's placement removes the landscape objects in its walk-block area). Approximation: a
 * building placed under the viewer's fog clears its ground the same tick, where a remembered static
 * would otherwise linger.
 */
export function bindFootprintClearing<Sprite>(
  surface: Pick<StaticDrawSurface<Sprite>, 'removeMapObject'>,
  placements: readonly number[],
  spriteByPlacement: ReadonlyMap<number, Sprite>,
  content: { readonly buildings: readonly FootprintBuildingType[] },
  snapshot: () => WorldSnapshot,
): (events: readonly SimEvent[]) => void {
  // First-wins, the index the sim resolves a type's footprint through.
  const buildingsByType = firstByTypeId(content.buildings);
  const standing = new Map<string, Sprite[]>();
  forEachPlacement(placements, (hx, hy, _type, ordinal) => {
    const sprite = spriteByPlacement.get(ordinal);
    if (sprite === undefined) return;
    const key = nodeKey(hx, hy);
    const at = standing.get(key);
    if (at === undefined) standing.set(key, [sprite]);
    else at.push(sprite);
  });

  const clearUnder = (building: SnapshotEntity): void => {
    const type = buildingTypeOf(building);
    const pos = positionOf(building);
    if (type === undefined || pos === undefined) return;
    const cells = buildingsByType.get(type)?.footprint?.blocked ?? [];
    const { hx, hy } = nodeOfPosition(pos.x, pos.y);
    for (const cell of cells) {
      const key = nodeKey(hx + footprintCellDx(hy, cell), hy + cell.dy);
      const at = standing.get(key);
      if (at === undefined) continue;
      standing.delete(key);
      for (const sprite of at) surface.removeMapObject(sprite);
    }
  };

  for (const entity of snapshot().entities) if (isBuilding(entity)) clearUnder(entity);

  return (events) => {
    let snap: WorldSnapshot | undefined;
    for (const event of events) {
      if (event.kind !== 'buildingPlaced' && event.kind !== 'buildingUpgraded') continue;
      snap ??= snapshot();
      const building = entityById(snap, event.entity);
      if (building !== undefined) clearUnder(building);
    }
  };
}
