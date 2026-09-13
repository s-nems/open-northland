import { enContent } from './catalogs/en-content.js';
import { enGame } from './catalogs/en-game.js';
import { enNetwork } from './catalogs/en-network.js';
import { enNetworkRoom } from './catalogs/en-network-room.js';
import { enSurfaces } from './catalogs/en-surfaces.js';

export const en = {
  network: enNetwork,
  networkRoom: enNetworkRoom,
  ...enContent,
  ...enSurfaces,
  ...enGame,
} as const;

type DeepStrings<T> = { readonly [K in keyof T]: T[K] extends string ? string : DeepStrings<T[K]> };

export type Messages = DeepStrings<typeof en>;
