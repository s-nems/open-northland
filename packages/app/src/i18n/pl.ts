import { plContent } from './catalogs/pl-content.js';
import { plGame } from './catalogs/pl-game.js';
import { plNetwork } from './catalogs/pl-network.js';
import { plNetworkRoom } from './catalogs/pl-network-room.js';
import { plSurfaces } from './catalogs/pl-surfaces.js';
import type { Messages } from './en.js';

export type { Messages } from './en.js';

export const pl = {
  network: plNetwork,
  networkRoom: plNetworkRoom,
  ...plContent,
  ...plSurfaces,
  ...plGame,
} as const satisfies Messages;
