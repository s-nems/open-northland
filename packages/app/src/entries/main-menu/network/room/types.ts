import type { SavedSessionMetadata } from '@open-northland/lockstep';
import type { RelayClient } from '@open-northland/net-client';
import type { enNetworkRoom } from '../../../../i18n/catalogs/en-network-room.js';

export type NetworkRoomCopy = { readonly [Key in keyof typeof enNetworkRoom]: string };
export type RoomClient = Pick<
  RelayClient,
  'nick' | 'claimSeat' | 'setSeat' | 'setSettings' | 'setReady' | 'start' | 'say'
>;

export interface NetworkRoomDeps {
  readonly client: RoomClient;
  readonly copy: NetworkRoomCopy;
  readonly savedRoster?: () => SavedSessionMetadata | null;
  readonly onLeave: () => void;
  /** The way back into a game that had already started when the player entered the room; null for
   *  a room entered in its lobby, whose start the screen follows on its own. */
  readonly rejoin: (() => void) | null;
  readonly onRetryCompatibility: () => void;
}
