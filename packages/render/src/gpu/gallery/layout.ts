/** One animation to show: its label + the `[bobseq]` range, its direction count, and its head base. */
export interface GalleryClip {
  readonly label: string;
  readonly start: number;
  readonly length: number;
  /**
   * Facings this clip is laid out for, derived by {@link clipDirs}: 8 for a full compass, 1 for a
   * single-direction clip, which ignores the facing selector and always plays its whole strip.
   */
  readonly dirs: number;
  /**
   * The bob id base to composite the head from; defaults to {@link start}, so head id equals body id.
   * Some carry-walk variants have empty head bobs and point this at the base walk start instead.
   */
  readonly headStart?: number;
}

/** Which facing every cell plays: a facing index `0..7` (the `CR_Hum_Body` block), or the whole strip. */
export type GalleryDirection = number | 'full';

/** The `CR_Hum_Body` 8-direction convention shared with the sprite bindings (no per-seq count in data). */
export const GALLERY_DIRS = 8;

/**
 * Block index (0..7) to draw for each compass step, in order `N, NE, E, SE, S, SW, W, NW` - inverted
 * from the `CR_Hum_Body` facing table (`0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S, 7 N`; source basis), so
 * "full" mode turns the character in a circle rather than through the storage order.
 */
export const COMPASS_TO_BLOCK: readonly number[] = [7, 3, 4, 5, 6, 0, 1, 2];

/** Advance one animation frame every N view frames, so ~60/N animation fps at ~60fps. The `?speed=`
 *  flag scales on top. */
export const TICKS_PER_FRAME = 8;

/** Cell geometry (px, native atlas scale). Tall enough for a standing human bob and its label. */
export const CELL_W = 112;
export const CELL_H = 148;
/** Feet anchor inside a cell, up from its bottom; the bob's authored offset lifts the art from there. */
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
 * The direction count a sequence `length` is laid out for: a clean ×8 length is 8-directional,
 * anything else is single-direction. An approximation - the readable data carries no explicit
 * per-sequence count, and this length heuristic matches observation (walk 96 → 8; eat 17, wait 57,
 * jump 21 → 1).
 */
export function clipDirs(length: number): number {
  return length > 0 && length % GALLERY_DIRS === 0 ? GALLERY_DIRS : 1;
}

/**
 * The body bob a clip draws at a facing and animation `step`, an integer frame counter to which the
 * caller has already applied the {@link TICKS_PER_FRAME} cadence. A numeric facing is a `CR_Hum_Body`
 * block index; `'full'` rotates through the directions in compass order ({@link COMPASS_TO_BLOCK}).
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
 * The head bob to composite for a given body bob: the same offset into the clip's head base. A
 * borrowed head keeps that offset, so it faces the walk heading while the body carries the load.
 */
export function headBobId(clip: GalleryClip, bodyBob: number): number {
  return (clip.headStart ?? clip.start) + (bodyBob - clip.start);
}
