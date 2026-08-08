import type { TextureSource } from 'pixi.js';
import type { AtlasFrame } from '../../data/sprites/index.js';
import type { TextureCache } from '../texture-cache.js';

/**
 * The decoded building-sign art contract shared by the door-badge and construction-sign layers. It owns
 * the chain layout too, so drawing and click picking cannot disagree on where a row is.
 */

/** One family living in a home, as its door banner reads it: a single, a childless couple, or a couple
 *  with a child. */
export type HouseholdKind = 'single' | 'couple' | 'family';

/** One sign row's meaning: a worker role, or a resident family's banner. */
export type DoorBadgeRole = 'craftsman' | 'carrier' | 'gatherer' | HouseholdKind;

/** One drawn sign row: its role, and the settler's entity id when the row stands for one settler (the
 *  click-pick target the app resolves). */
export interface DoorBadgeRow {
  readonly role: DoorBadgeRole;
  readonly settler?: number;
}

/** Which `ls_temp` sign a marker draws: a residence banner, the worker disc (crossed hammer+axe), the
 *  carrier pennant, or the construction-site stand. */
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
  /** The garrison flag's wave loop per star count, index 0 = one star. Absent when the slot's
   *  `soldier 01`..`05` records did not resolve, which leaves a manned post on the placeholder flag. */
  readonly garrison?: readonly (readonly AtlasFrame[])[];
}

/** The decoded sign art the app resolves and hands the renderer, indexed by player slot (0-based
 *  `Owner.player`). */
export interface BuildingSignGfx {
  readonly byPlayer: readonly (BuildingSignSheet | undefined)[];
}

export interface SignGfx extends BuildingSignGfx {
  readonly textures: TextureCache;
}

/** The sheet a marker draws for a resolved colour slot: its own recolour, else slot 0's - the fallback a
 *  slot beyond the original's 10, or a failed atlas load, lands on. */
export function sheetFor(gfx: SignGfx, colour: number): BuildingSignSheet | undefined {
  return gfx.byPlayer[colour] ?? gfx.byPlayer[0];
}

/** The identity owner→colour mapping - the default when a session carries no roster recolouring. */
export const IDENTITY_COLOUR = (player: number): number => player;

/**
 * Vertical world-px between stacked sign anchors. The banner cloth is exactly 21 px tall ending 5 px
 * above its anchor, so a 20 px step makes each chained banner end flush on the sign below. The original
 * plants one sign record per occupant; the chain layout is an approximation of its stacking.
 */
export const SIGN_STEP = 20;

/** World-px a sign's emblem tops out above its anchor (the frames author `offsetY` of about -26). */
export const SIGN_HEIGHT = 26;

/**
 * Every `ls_temp` sign frame carries a rock clump at its planted base; a chained row (above the first)
 * draws a base-cropped variant so the clump doesn't sit on the emblem below. The cut is the lowest kept
 * pixel row in anchor space (+y down), measured per kind from the frames: the banner cloth ends at -5,
 * the disc rim at -2, the pennant tail at -3. The construction stand never chains, so it keeps its base.
 */
const CHAIN_BASE_CUT: Readonly<Partial<Record<BuildingSignKind, number>>> = {
  worker: -2,
  carrier: -3,
  single: -5,
  couple: -5,
  family: -5,
};

/** Memoized base-cropped frames, one per source frame: the texture cache keys by frame object, so a
 *  chained row must reuse a stable cropped object. Safe to key by frame alone because kinds never share
 *  a frame object; a shared one would inherit the first kind's cut. */
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

/** World-px half-width of a stack's click box. The widest badge frame is the worker disc, 25 px at
 *  `offsetX` -13, so it reaches 13 px left and 12 px right of the anchor; the box is symmetric at 14, a
 *  pixel of slack past that reach. */
const SIGN_HALF_WIDTH = 14;

/**
 * World-px the construction stand is planted left of the shared sign post, so it stands beside a site's
 * door badges instead of over them - both markers anchor on the same extracted `GfxFlagPoint`. Two
 * {@link SIGN_HALF_WIDTH}s clears the widest badge frame, the disc. Approximation: the original plants
 * its stand on the flag point, and this offset is a pixel judgement.
 */
export const CONSTRUCTION_SIGN_DX = -2 * SIGN_HALF_WIDTH;
/** World-px the planted base sign's rock clump extends below the stack anchor. */
const SIGN_BASE_BELOW = 8;
/** Anchor-space split between a row's emblem band and the band above it - just under the banner cloth
 *  (-5) and the disc rim (-2), so each 20 px band covers one emblem (an approximation for clicking). */
const SIGN_BAND_BOTTOM = 6;

/**
 * The stack row index at `(dx, dy)` world-px from the stack's anchor (+y down), or `null` outside the
 * stack. Row 0 is the planted base sign and also owns the clump below the anchor; each row above owns the
 * {@link SIGN_STEP} band over its emblem. The same layout `makeSignStack` draws.
 */
export function signRowAt(rowCount: number, dx: number, dy: number): number | null {
  if (rowCount <= 0 || Math.abs(dx) > SIGN_HALF_WIDTH || dy > SIGN_BASE_BELOW) return null;
  const row = dy >= -SIGN_BAND_BOTTOM ? 0 : Math.floor((-dy - SIGN_BAND_BOTTOM) / SIGN_STEP);
  return row < rowCount ? row : null;
}
