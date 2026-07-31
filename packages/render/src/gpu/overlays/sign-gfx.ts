import type { TextureSource } from 'pixi.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import type { TextureCache } from '../texture-cache.js';

/**
 * The decoded building-sign art contract shared by the door-badge and construction-sign layers - the
 * one owner of the sign-art fallback rules: a player slot with no recoloured sheet (the extras beyond
 * the original's 10, or a failed atlas load) draws slot 0's sheet ({@link sheetFor}), and with no art
 * at all each layer degrades on its own (the badge layer to placeholder squares, the construction
 * layer to nothing - the plot overlay already marks a site).
 */

/** One family living in a home, as its door banner reads it: a single, a childless couple, or a couple
 *  with their growing child - each draws its own residence banner. */
export type HouseholdKind = 'single' | 'couple' | 'family';

/** Which `ls_temp` sign a marker draws: a {@link HouseholdKind} residence banner, the worker disc
 *  (crossed hammer+axe), the carrier pennant, or the construction-site stand. */
export type BuildingSignKind = HouseholdKind | 'worker' | 'carrier' | 'construction';

/** One player's recoloured sign art: that player's `ls_temp` atlas page + the frame each sign kind
 *  draws. Frames are per-sheet objects (never shared across pages - the texture cache keys by frame). */
export interface BuildingSignSheet {
  readonly source: TextureSource;
  readonly frameByKind: Readonly<Record<BuildingSignKind, AtlasFrame>>;
}

/** The decoded sign art the app resolves and hands the renderer, indexed by player slot (0-based
 *  `Owner.player`). */
export interface BuildingSignGfx {
  readonly byPlayer: readonly (BuildingSignSheet | undefined)[];
}

/** {@link BuildingSignGfx} plus the consuming layer's frame→texture cache. */
export interface SignGfx extends BuildingSignGfx {
  readonly textures: TextureCache;
}

/** The sheet a marker draws for a resolved colour slot: its own recolour, else slot 0's. */
export function sheetFor(gfx: SignGfx, colour: number): BuildingSignSheet | undefined {
  return gfx.byPlayer[colour] ?? gfx.byPlayer[0];
}

/** The identity owner→colour mapping - the default when a session carries no roster recolouring. */
export const IDENTITY_COLOUR = (player: number): number => player;
