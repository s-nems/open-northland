import { BUILDING_KIND, type BuildingType } from '@open-northland/data';
import type { PlacementOverlayCell } from '@open-northland/render';
import { nodeOfPosition, type TileBox, type WorldSnapshot } from '@open-northland/sim';
import {
  buildingRecordOf,
  buildingTribeOf,
  buildingTypeOf,
  ownerPlayerOf,
  positionOf,
} from '../../game/snapshot/index.js';
import { nodeBounds } from '../picking.js';
import { buildingsIn } from './building-buckets.js';
import { doorNode } from './building-points.js';
import type { BuildingDoorInfoOf } from './door-badges.js';

/** Whether settlers walk in at a standing building's door: it employs, houses, stores, schools, shelters
 *  or blesses them. A vehicle yard's site launches a vehicle instead of standing, and a wall piece or a
 *  wonder takes nobody in, so a road to their door serves nothing. */
export function takesSettlersIn(type: BuildingType): boolean {
  if (type.kind === BUILDING_KIND.vehicle) return false;
  return (
    type.workers.length > 0 ||
    type.homeSize > 0 ||
    type.stock.length > 0 ||
    (type.schoolSize ?? 0) > 0 ||
    type.shelterCapacity > 0 ||
    type.prayerSite !== undefined
  );
}

/** The door nodes of `owner`'s buildings and building sites standing in `box`, ascending by building id:
 *  the entrances the road tool lights. A door counts only for a type settlers enter
 *  ({@link takesSettlersIn}), and one past the edge of the `mapSize` cell grid takes no road. */
export function computeRoadEntrances(
  snapshot: WorldSnapshot,
  buildingInfoOf: BuildingDoorInfoOf,
  owner: number,
  box: TileBox,
  mapSize: { readonly width: number; readonly height: number },
): PlacementOverlayCell[] {
  const out: PlacementOverlayCell[] = [];
  const nodes = nodeBounds(mapSize);
  for (const e of buildingsIn(snapshot, box)) {
    if (ownerPlayerOf(e) !== owner) continue;
    const pos = positionOf(e);
    if (pos === undefined) continue;
    const info = buildingInfoOf(buildingTypeOf(e), buildingTribeOf(e), e.id, buildingRecordOf(e));
    if (info?.entered !== true || info.footprint?.door === undefined) continue;
    const door = doorNode(info.footprint, nodeOfPosition(pos.x, pos.y));
    if (door.hx < 0 || door.hy < 0 || door.hx >= nodes.width || door.hy >= nodes.height) continue;
    out.push({ col: door.hx, row: door.hy });
  }
  return out;
}
