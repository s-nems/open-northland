import type { TextureSource } from 'pixi.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import type { TextureCache } from '../texture-cache.js';

/**
 * The decoded building-sign art contract shared by the door-badge and construction-sign layers - the
 * one owner of the sign-art fallback rules: a player slot with no recoloured sheet (the extras beyond
 * the original's 10, or a failed atlas load) draws slot 0's sheet ({@link sheetFor}), and with no art
 * at all each layer degrades on its own (the badge layer to placeholder squares, the construction
 * layer to nothing - the plot overlay already marks a site). Also the one owner of the chain layout
 * ({@link SIGN_STEP}, {@link signRowAt}) so drawing and click picking cannot disagree on where a row is.
 */

/** One family living in a home, as its door banner reads it: a single, a childless couple, or a couple
 *  with their growing child - each draws its own residence banner. */
export type HouseholdKind = 'single' | 'couple' | 'family';

/** One sign row's meaning: a worker role (craftsman/gatherer draw the worker disc, a carrier the
 *  pennant) or a resident family's banner. */
export type DoorBadgeRole = 'craftsman' | 'carrier' | 'gatherer' | HouseholdKind;

/** Which `ls_temp` sign a marker draws: a {@link HouseholdKind} residence banner, the worker disc
 *  (crossed hammer+axe), the carrier pennant, or the construction-site stand. */
export type BuildingSignKind = HouseholdKind | 'worker' | 'carrier' | 'construction';

/** The `ls_temp` sign a badge row draws - the original's one workplace disc covers every non-carrier trade. */
export function signKindOf(role: DoorBadgeRole): BuildingSignKind {
  return role === 'craftsman' || role === 'gatherer' ? 'worker' : role;
}

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

/**
 * Vertical world-px between stacked sign anchors. The banner cloth is exactly 21 px tall ending 5 px
 * above its anchor, so a 20 px step makes each chained (base-cropped) banner end flush on the sign
 * below - the stack reads as one connected chain (the original plants sign records per occupant; the
 * chain layout is our approximation of its stacking).
 */
export const SIGN_STEP = 20;

/** World-px a sign's emblem tops out above its anchor (the frames author `offsetY` of about -26) - the
 *  hearts float relative to the stack's top emblem, and {@link signRowAt}'s top band ends here. */
export const SIGN_HEIGHT = 26;

/**
 * Every `ls_temp` sign frame carries a rock clump at its planted base; a chained row (above the first)
 * draws a base-cropped variant so the clump doesn't sit on the emblem below. The cut is the lowest kept
 * pixel row in anchor space (+y down), measured per kind from the frames: the banner cloth ends at -5,
 * the disc rim at -2, the pennant tail at -3; the clump starts just below each. The construction stand
 * never chains, so it keeps its base.
 */
const CHAIN_BASE_CUT: Readonly<Partial<Record<BuildingSignKind, number>>> = {
  worker: -2,
  carrier: -3,
  single: -5,
  couple: -5,
  family: -5,
};

/** Memoized base-cropped frames, 1:1 per source frame - the texture cache keys by frame object, so a
 *  chained row must reuse one stable cropped object rather than allocate per rebuild. Keying by frame
 *  alone is safe because kinds never share a frame object ({@link BuildingSignSheet}); a shared one
 *  would silently inherit the first kind's cut. */
const chainedFrames = new WeakMap<AtlasFrame, AtlasFrame>();

/** The base-cropped frame a chained row draws for `kind`, or the frame itself when the kind keeps its
 *  base (the construction stand) or the cut would not shrink it. */
export function chainedFrame(kind: BuildingSignKind, frame: AtlasFrame): AtlasFrame {
  const cut = CHAIN_BASE_CUT[kind];
  if (cut === undefined) return frame;
  const height = cut - frame.offsetY + 1;
  if (height <= 0 || height >= frame.height) return frame;
  let cropped = chainedFrames.get(frame);
  if (cropped === undefined) {
    cropped = { ...frame, height };
    chainedFrames.set(frame, cropped);
  }
  return cropped;
}

/** World-px the widest sign frame (the disc, 25 px) reaches sideways from a stack's anchor - the
 *  click-pick half-width. */
const SIGN_HALF_WIDTH = 14;

/**
 * World-px the construction stand is planted LEFT of the shared sign post, so it stands beside the door
 * badges instead of over them. Both markers anchor on the same extracted `GfxFlagPoint`, and a building
 * under construction now carries both at once: its build crew and the staff posted to it draw their badge
 * chain there while the stand marks the site. Two sign half-widths clears the widest badge frame.
 */
export const CONSTRUCTION_SIGN_DX = -2 * SIGN_HALF_WIDTH;
/** World-px the planted base sign's rock clump extends below the stack anchor. */
const SIGN_BASE_BELOW = 8;
/** Anchor-space split between a row's emblem band and the band above it - just under the banner cloth
 *  (-5) and the disc rim (-2), so each 20 px band covers one emblem (an approximation for clicking). */
const SIGN_BAND_BOTTOM = 6;

/**
 * The stack row index at `(dx, dy)` world-px from the stack's anchor (+y down), or `null` outside the
 * stack. Row 0 is the planted base sign; each row above owns the {@link SIGN_STEP} band over its emblem,
 * and the base row additionally owns the clump below the anchor. The same layout `makeSignStack` draws,
 * so a click lands on the row the player sees.
 */
export function signRowAt(rowCount: number, dx: number, dy: number): number | null {
  if (rowCount <= 0 || Math.abs(dx) > SIGN_HALF_WIDTH || dy > SIGN_BASE_BELOW) return null;
  const row = dy >= -SIGN_BAND_BOTTOM ? 0 : Math.floor((-dy - SIGN_BAND_BOTTOM) / SIGN_STEP);
  return row < rowCount ? row : null;
}
