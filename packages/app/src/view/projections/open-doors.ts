import { collectRebuiltPositioned, isIndoorSettler } from '@open-northland/render/data';
import {
  type EntitySnapshot,
  hexNeighboursOf,
  nodeHxOfPosition,
  nodeHyOfPosition,
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

/** Reused set of the stands the box's settlers take. */
const stands = new Set<number>();

/** Spans a half-cell coordinate and a player slot stay under, so a stand packs into one exact number. */
const NODE_SPAN = 2 ** 20;
const PLAYER_SPAN = 2 ** 10;

const standKey = (hx: number, hy: number, player: number): number =>
  (hy * NODE_SPAN + hx) * PLAYER_SPAN + player;

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
  stands.clear();
  // The scene's own index of the kinds it rebuilds, settlers among them: no tree or pile is walked.
  const count = collectRebuiltPositioned(snapshot, box, positioned);
  for (let i = 0; i < count; i++) {
    const e = positioned[i] as SnapshotEntity;
    if (!isSettler(e)) continue;
    const player = ownerPlayerOf(e);
    const at = positionOf(e);
    if (player === undefined || at === undefined) continue;
    const tribe = settlerTribeOf(e);
    if (tribe !== undefined && isLivestockTribe(tribe)) continue;
    if (isIndoorSettler(snapshot, e.components)) continue;
    stands.add(standKey(nodeHxOfPosition(at.x, at.y), nodeHyOfPosition(at.x, at.y), player));
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
