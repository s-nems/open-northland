import { isIndoorSettler } from '@open-northland/render/data';
import {
  collectPositioned,
  type EntitySnapshot,
  hexNeighboursOf,
  nodeOfPosition,
  type TileBox,
  type WorldSnapshot,
} from '@open-northland/sim';
import {
  buildingRecordOf,
  buildingTribeOf,
  buildingTypeOf,
  isSettler,
  ownerPlayerOf,
  positionOf,
  type SnapshotEntity,
  settlerTribeOf,
} from '../../game/snapshot/index.js';
import { buildingsIn } from './building-buckets.js';
import { doorNode } from './building-points.js';
import type { BuildingDoorInfoOf } from './door-badges.js';

/** Reused output of the box's position query. */
const positioned: EntitySnapshot[] = [];

const standKey = (hx: number, hy: number, player: number): string => `${hx},${hy},${player}`;

/**
 * The finished buildings in `box` whose door stands open, ascending by id. Original behavior: a door is
 * open exactly while a drawn person of the building's own player stands on its door node or one of the
 * six beside it; one inside the house is not drawn, so the door shuts behind it. Farm animals hold no
 * door (`isLivestockTribe`). One pass over the box's settlers, then seven lookups a door.
 */
export function computeOpenDoors(
  snapshot: WorldSnapshot,
  buildingInfoOf: BuildingDoorInfoOf,
  isLivestockTribe: (tribe: number) => boolean,
  box: TileBox,
): number[] {
  const houses = buildingsIn(snapshot, box);
  if (houses.length === 0) return [];
  const stands = new Set<string>();
  const count = collectPositioned(snapshot, box, positioned);
  for (let i = 0; i < count; i++) {
    const e = positioned[i] as SnapshotEntity;
    if (!isSettler(e)) continue;
    const player = ownerPlayerOf(e);
    const at = positionOf(e);
    if (player === undefined || at === undefined) continue;
    const tribe = settlerTribeOf(e);
    if (tribe !== undefined && isLivestockTribe(tribe)) continue;
    if (isIndoorSettler(snapshot, e.components)) continue;
    const node = nodeOfPosition(at.x, at.y);
    stands.add(standKey(node.hx, node.hy, player));
  }
  if (stands.size === 0) return [];
  const open: number[] = [];
  for (const house of houses) {
    if (house.components.UnderConstruction !== undefined) continue;
    const owner = ownerPlayerOf(house);
    const pos = positionOf(house);
    if (owner === undefined || pos === undefined) continue;
    const info = buildingInfoOf(
      buildingTypeOf(house),
      buildingTribeOf(house),
      house.id,
      buildingRecordOf(house),
    );
    if (info?.footprint?.door === undefined) continue;
    const door = doorNode(info.footprint, nodeOfPosition(pos.x, pos.y));
    if (
      stands.has(standKey(door.hx, door.hy, owner)) ||
      hexNeighboursOf(door.hx, door.hy).some((n) => stands.has(standKey(n.hx, n.hy, owner)))
    ) {
      open.push(house.id);
    }
  }
  return open;
}
