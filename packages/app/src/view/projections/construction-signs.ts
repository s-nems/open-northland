import type { ConstructionSign } from '@open-northland/render';
import { nodeOfPosition, positionOfNode, type WorldSnapshot } from '@open-northland/sim';
import {
  actorsOf,
  buildingTribeOf,
  buildingTypeOf,
  isBuilding,
  ownerPlayerOf,
  positionOf,
} from '../../game/snapshot.js';
import { doorNode } from './building-points.js';
import type { BuildingDoorInfoOf } from './door-badges.js';

/**
 * One player-coloured construction stand per building carrying `UnderConstruction`, planted at the
 * type's `GfxFlagPoint` sign post or the door node when the content has none. An in-place upgrade
 * re-opens the building as a site, so it signs too.
 */
export function computeConstructionSigns(
  snapshot: WorldSnapshot,
  buildingInfoOf: BuildingDoorInfoOf,
): ConstructionSign[] {
  const out: ConstructionSign[] = [];
  for (const e of actorsOf(snapshot)) {
    if (!isBuilding(e) || e.components.UnderConstruction === undefined) continue;
    const pos = positionOf(e);
    if (pos === undefined) continue;
    const info = buildingInfoOf(buildingTypeOf(e), buildingTribeOf(e));
    const player = ownerPlayerOf(e);
    if (info?.flagPoint !== undefined) {
      out.push({
        id: e.id,
        x: pos.x,
        y: pos.y,
        dx: info.flagPoint.x,
        dy: info.flagPoint.y,
        ...(player !== undefined ? { player } : {}),
      });
      continue;
    }
    const node = doorNode(info?.footprint, nodeOfPosition(pos.x, pos.y));
    const dpos = positionOfNode(node.hx, node.hy);
    out.push({ id: e.id, x: dpos.x, y: dpos.y, ...(player !== undefined ? { player } : {}) });
  }
  return out;
}
