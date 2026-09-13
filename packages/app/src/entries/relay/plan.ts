import { MAX_ROOM_ID_LENGTH } from '@open-northland/net-protocol';
import { relayAddress } from '../../net/address.js';
import { intParam } from '../../view/params.js';

/** The `room=` value that creates a room instead of joining one. */
export const NEW_ROOM = 'new';
/** People the creator waits for when `?players=` names none. */
const DEFAULT_PLAYERS = 2;

export type RelayRoomPlan =
  | { readonly kind: 'join'; readonly id: string }
  | { readonly kind: 'create'; readonly mapId: string; readonly players: number };

/** What `?relay=<url>&room=<id|new>` asks for; null when the search cannot be honoured. */
export interface RelayPlan {
  readonly url: string;
  readonly room: RelayRoomPlan;
}

export function relayPlan(params: URLSearchParams): RelayPlan | null {
  const url = relayAddress(params.get('relay') ?? '');
  const room = params.get('room');
  if (url === null || room === null || room.length === 0 || room.length > MAX_ROOM_ID_LENGTH) return null;
  if (room !== NEW_ROOM) return { url, room: { kind: 'join', id: room } };
  const mapId = params.get('map');
  if (mapId === null || mapId.length === 0) return null;
  return { url, room: { kind: 'create', mapId, players: intParam(params, 'players', DEFAULT_PLAYERS, 1) } };
}

/** The same search with the created room's id in place of `new`, so a reload rejoins it. */
export function searchWithRoom(params: URLSearchParams, roomId: string): string {
  const next = new URLSearchParams(params);
  next.set('room', roomId);
  return `?${next.toString()}`;
}
