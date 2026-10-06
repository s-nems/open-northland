import { deContent } from './catalogs/de-content.js';
import { deGame } from './catalogs/de-game.js';
import { deNetwork } from './catalogs/de-network.js';
import { deNetworkRelay } from './catalogs/de-network-relay.js';
import { deNetworkRoom } from './catalogs/de-network-room.js';
import { deSurfaces } from './catalogs/de-surfaces.js';
import type { Messages } from './en.js';

export const de = {
  network: deNetwork,
  networkRoom: deNetworkRoom,
  networkRelay: deNetworkRelay,
  ...deContent,
  ...deSurfaces,
  ...deGame,
} as const satisfies Messages;
