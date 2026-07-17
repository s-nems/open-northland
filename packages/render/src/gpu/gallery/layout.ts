/**
 * The pure half of the animation gallery: clip metadata, the grid layout and the frame-selection math —
 * unit-testable without a GPU (see test/animation-gallery.test.ts). The retained Pixi view lives in
 * {@link import('./animation-gallery.js')}.
 */

/** One animation to show: its label + the `[bobseq]` range, its direction count, and its head base. */
export interface GalleryClip {
  readonly label: string;
  readonly start: number;
  readonly length: number;
  /**
   * Facings this clip is laid out for, derived by {@link clipDirs}: 8 (a full compass — `length` is a clean
   * ×8, e.g. walk 96) or 1 (single-direction — `length` isn't ×8, e.g. eat 17, wait 57, jump 21; the
   * original plays these locked to one facing). A single-direction clip ignores the facing selector and
   * always plays its whole strip.
   */
  readonly dirs: number;
  /**
   * The bob id base to composite the head from (defaults to {@link start}, i.e. head id == body id). Some
   * carry-walk variants have empty head bobs, so this points at the base `human_man_generic_walk` start to
   * borrow its head (see {@link headBobId}).
   */
  readonly headStart?: number;
}

/** Which facing every cell plays: a facing index `0..7` (the `CR_Hum_Body` block), or the whole strip. */
export type GalleryDirection = number | 'full';

/** The `CR_Hum_Body` 8-direction convention shared with the sprite bindings (no per-seq count in data). */
export const GALLERY_DIRS = 8;

/**
 * Block index (0..7) to draw for each compass step, in order `N, NE, E, SE, S, SW, W, NW` — inverted from
 * the `CR_Hum_Body` facing table (`0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S, 7 N`; source basis). "Full" mode
 * walks this order so the character turns in a circle (N→NE→E→…) instead of the storage order
 * (SW→W→NW→NE→…).
 */
export const COMPASS_TO_BLOCK: readonly number[] = [7, 3, 4, 5, 6, 0, 1, 2];

/**
 * Default cadence: advance one animation frame every N view frames, so ~60/N animation fps at ~60fps (`8`
 * ≈ 7.5fps, slow enough to read each pose). The `?speed=` flag scales on top.
 */
export const TICKS_PER_FRAME = 8;

/** Cell geometry (px, native atlas scale). Tall enough for a standing human bob + its label above it. */
export const CELL_W = 112;
export const CELL_H = 148;
/** Feet anchor inside a cell: horizontally centred, near the bottom (the bob's authored offset lifts it up). */
export const FOOT_INSET_Y = 26;
/** Label baseline from the cell top. */
export const LABEL_Y = 6;

/** One cell's grid placement. */
export interface GalleryCellBox {
  readonly index: number;
  readonly col: number;
  readonly row: number;
  /** Top-left of the cell. */
  readonly x: number;
  readonly y: number;
}

/** Lay `count` cells out row-major into `columns` columns of {@link CELL_W}×{@link CELL_H}. */
export function galleryCellLayout(count: number, columns: number): readonly GalleryCellBox[] {
  const cols = Math.max(1, Math.floor(columns));
  const out: GalleryCellBox[] = [];
  for (let index = 0; index < count; index++) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    out.push({ index, col, row, x: col * CELL_W, y: row * CELL_H });
  }
  return out;
}

/**
 * The direction count a sequence `length` is laid out for: a clean ×8 length is 8-directional, anything
 * else is single-direction (the original plays a non-×8 animation locked to one facing). Approximation:
 * the readable data carries no explicit per-sequence count, so this length heuristic stands in, and it
 * matches observation (walk 96 → 8; eat 17 / wait 57 / jump 21 → 1).
 */
export function clipDirs(length: number): number {
  return length > 0 && length % GALLERY_DIRS === 0 ? GALLERY_DIRS : 1;
}

/**
 * The body bob a clip draws at a facing + animation `step` (an integer frame counter; the caller applies
 * the {@link TICKS_PER_FRAME} cadence). Cases:
 *  - single-direction clip (`dirs <= 1`) → the whole strip in order, ignoring the requested facing;
 *  - 8-dir + numeric facing (a `CR_Hum_Body` block index) → that direction's `stride`-frame sub-cycle;
 *  - 8-dir + `'full'` → rotate through all directions in compass order ({@link COMPASS_TO_BLOCK}), each
 *    playing its full sub-cycle.
 */
export function galleryBobId(clip: GalleryClip, direction: GalleryDirection, step: number): number {
  if (clip.dirs <= 1) return clip.start + (step % Math.max(1, clip.length));
  const stride = Math.floor(clip.length / clip.dirs);
  if (stride <= 0) return clip.start;
  if (direction === 'full') {
    const slot = Math.floor(step / stride) % clip.dirs;
    const block = COMPASS_TO_BLOCK[slot] ?? slot;
    return clip.start + block * stride + (step % stride);
  }
  const block = ((direction % clip.dirs) + clip.dirs) % clip.dirs;
  return clip.start + block * stride + (step % stride);
}

/**
 * The head bob to composite for a given body bob: the same offset into the clip's head base ({@link
 * GalleryClip.headStart}, defaulting to the body `start`). A borrowed head keeps that same (direction,
 * frame) offset, so it faces the walk heading while the body carries the load.
 */
export function headBobId(clip: GalleryClip, bodyBob: number): number {
  return (clip.headStart ?? clip.start) + (bodyBob - clip.start);
}
