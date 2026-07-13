import { plContent } from './catalogs/pl-content.js';
import { plGame } from './catalogs/pl-game.js';
import { plSurfaces } from './catalogs/pl-surfaces.js';
import type { Messages } from './en.js';

export type { Messages } from './en.js';

export const pl = {
  ...plContent,
  ...plSurfaces,
  ...plGame,
} as const satisfies Messages;
