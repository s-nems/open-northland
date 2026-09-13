import type { RoomView } from '@open-northland/net-protocol';
import { loadMapList } from '../maps-index.js';
import { loadPersistedMap } from './cache.js';
import { mapDeliveryAllowed } from './codec.js';
import { loadVerifiedMapDocuments, type VerifiedMapDocuments } from './documents.js';

export async function loadRoomMapDocuments(
  room: RoomView,
  services: {
    readonly local?: typeof loadVerifiedMapDocuments;
    readonly cached?: typeof loadPersistedMap;
    readonly list?: typeof loadMapList;
  } = {},
): Promise<VerifiedMapDocuments | null> {
  if (room.settings.world.kind !== 'map') return null;
  const mapId = room.settings.world.mapId;
  const fingerprint = room.members.find((member) => member.nick === room.creator)?.compatibility?.map;
  const local = await (services.local ?? loadVerifiedMapDocuments)(mapId);
  if (local !== null) {
    if (fingerprint != null && local.fingerprint !== fingerprint)
      throw new Error('Local map differs from the session');
    return local;
  }
  const origin = room.settings.mapOrigin;
  if (fingerprint == null || origin === undefined) return null;
  const listed = await (services.list ?? loadMapList)();
  if (
    listed.some(
      (entry) => entry.id.toLowerCase() === mapId.toLowerCase() && !mapDeliveryAllowed(entry.provenance),
    )
  )
    return null;
  return (await (services.cached ?? loadPersistedMap)(mapId, { fingerprint, origin }))?.handle ?? null;
}
