import type { ConstructionSign } from '@open-northland/render';
import { nodeOfPosition, positionOfNode, type WorldSnapshot } from '@open-northland/sim';
import { actorsOf, buildingTypeOf, isBuilding, ownerPlayerOf, positionOf } from '../../game/snapshot.js';
import { doorNode } from './building-points.js';
import type { BuildingDoorInfo } from './door-badges.js';

/**
 * The construction-sign projection: one player-coloured `ls_temp` construction stand per building
 * carrying `UnderConstruction` - the one component both a fresh build and a running upgrade carry (the
 * upgrade command re-opens the building as a site), planted at the door node. Pure over the snapshot +
 * the building-type door table; called once per tick via the shared snapshot memo.
 */
export function computeConstructionSigns(
  snapshot: WorldSnapshot,
  buildingsByType: ReadonlyMap<number, BuildingDoorInfo>,
): ConstructionSign[] {
  const out: ConstructionSign[] = [];
  for (const e of actorsOf(snapshot)) {
    if (!isBuilding(e) || e.components.UnderConstruction === undefined) continue;
    const pos = positionOf(e);
    if (pos === undefined) continue;
    const anchor = nodeOfPosition(pos.x, pos.y);
    const typeId = buildingTypeOf(e);
    const info = typeId !== undefined ? buildingsByType.get(typeId) : undefined;
    const node = doorNode(info?.footprint, anchor);
    const dpos = positionOfNode(node.hx, node.hy);
    const player = ownerPlayerOf(e);
    out.push({ id: e.id, x: dpos.x, y: dpos.y, ...(player !== undefined ? { player } : {}) });
  }
  return out;
}
