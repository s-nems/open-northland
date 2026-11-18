import type { PlacementOverlayCell } from '@open-northland/render';
import { entitiesWith, nodeOfPosition, type TileBox, type WorldSnapshot } from '@open-northland/sim';
import {
  buildingRecordOf,
  buildingTribeOf,
  buildingTypeOf,
  ownerPlayerOf,
  positionOf,
} from '../../game/snapshot/index.js';
import { buildingsIn } from './building-buckets.js';
import { doorNode } from './building-points.js';
import type { BuildingDoorInfoOf } from './door-badges.js';

/** The door nodes of `owner`'s buildings and building sites standing in `box`, ascending by building id:
 *  the entrances the road tool lights. A type without a door has none; no box reads the whole map. */
export function computeRoadEntrances(
  snapshot: WorldSnapshot,
  buildingInfoOf: BuildingDoorInfoOf,
  owner: number,
  box?: TileBox,
): PlacementOverlayCell[] {
  const out: PlacementOverlayCell[] = [];
  const buildings = box === undefined ? entitiesWith(snapshot, 'Building') : buildingsIn(snapshot, box);
  for (const e of buildings) {
    if (ownerPlayerOf(e) !== owner) continue;
    const pos = positionOf(e);
    if (pos === undefined) continue;
    const footprint = buildingInfoOf(
      buildingTypeOf(e),
      buildingTribeOf(e),
      e.id,
      buildingRecordOf(e),
    )?.footprint;
    if (footprint?.door === undefined) continue;
    const door = doorNode(footprint, nodeOfPosition(pos.x, pos.y));
    out.push({ col: door.hx, row: door.hy });
  }
  return out;
}
