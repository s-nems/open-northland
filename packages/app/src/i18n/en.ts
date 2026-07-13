import { enContent } from './catalogs/en-content.js';
import { enGame } from './catalogs/en-game.js';
import { enSurfaces } from './catalogs/en-surfaces.js';

export const en = {
  ...enContent,
  ...enSurfaces,
  ...enGame,
} as const;

type DeepStrings<T> = { readonly [K in keyof T]: T[K] extends string ? string : DeepStrings<T[K]> };

export type Messages = DeepStrings<typeof en>;
