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
  readonly onRetryCompatibility: () => void;
}
