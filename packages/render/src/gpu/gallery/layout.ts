/**
 * The PURE half of the animation gallery: clip metadata, the grid layout and the frame-selection math —
 * unit-testable without a GPU (see test/animation-gallery.test.ts). The retained Pixi view lives in
 * {@link import('./animation-gallery.js')}.
 */

/** One animation to show: its label + the `[bobseq]` range, its direction count, and its head base. */
export interface GalleryClip {
  readonly label: string;
  readonly start: number;
  readonly length: number;
  /**
   * Facings this clip is laid out for: **8** (a full compass — `length` is a clean ×8, e.g. walk 96) or
   * **1** (single-direction — `length` isn't ×8, e.g. eat 17, wait 57, a jump 21; the original plays these
   * locked to one facing). Derived by {@link clipDirs}. A single-direction clip ignores the facing selector
   * and always plays its whole strip, so a non-directional animation isn't chopped into fake directions.
   */
  readonly dirs: number;
  /**
   * The bob id base to composite the HEAD from (defaults to {@link start} = head id == body id). Some
   * carry-walk variants have EMPTY head bobs (the head is authored once, on the base walk, and reused); for
   * those this points at the base `human_man_generic_walk` start so the head is borrowed at the SAME
   * (direction, frame) offset — the head faces the walk heading while the body carries the load.
   */
  readonly headStart?: number;
}

/** Which facing every cell plays: a facing index `0..7` (the `CR_Hum_Body` block), or the whole strip. */
export type GalleryDirection = number | 'full';

/** The `CR_Hum_Body` 8-direction convention shared with the sprite bindings (no per-seq count in data). */
export const GALLERY_DIRS = 8;

/**
 * Block index (0..7) to draw for each COMPASS step, in order `N, NE, E, SE, S, SW, W, NW` — inverted from
 * the `CR_Hum_Body` facing table (`0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S, 7 N`; source basis). "Full"
 * mode walks this order so the character turns in a clean circle (N→NE→E→…) instead of the jumbled
 * storage order (SW→W→NW→NE→…) — the "ładne kółko" that makes 8 facings easy to verify.
 */
export const COMPASS_TO_BLOCK: readonly number[] = [7, 3, 4, 5, 6, 0, 1, 2];

/**
 * Slow the cadence so a human can actually watch each frame (advance one anim frame every N view frames).
 * At ~60fps this is ~60/N animation fps: `8` ≈ 7.5fps — calm enough to read each pose. The `?speed=` flag
 * scales on top (e.g. `?speed=0.5` halves it again, `?speed=2` doubles), so this is just the default pace.
 */
export const TICKS_PER_FRAME = 8;

/** Cell geometry (px, native atlas scale). Tall enough for a standing human bob + its label above it. */
export const CELL_W = 112;
export const CELL_H = 148;
/** Feet anchor inside a cell: horizontally centred, near the bottom (the bob's authored offset lifts it up). */
export const FOOT_INSET_Y = 26;
/** Label baseline from the cell top. */
export const LABEL_Y = 6;

/** One cell's grid placement — pure, so the layout is unit-testable without a GPU. */
export interface GalleryCellBox {
  readonly index: number;
  readonly col: number;
  readonly row: number;
  /** Top-left of the cell. */
  readonly x: number;
  readonly y: number;
}

/**
 * Lay `count` cells out row-major into `columns` columns of {@link CELL_W}×{@link CELL_H} — the wrapped
 * grid the gallery draws (the catalog's row-major placement, generalised). Pure + total.
 */
export function galleryCellLayout(count: number, columns: number): GalleryCellBox[] {
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
 * else is single-direction (the original plays a non-×8 animation locked to one facing). The readable data
 * carries no explicit per-sequence count (no oracle — source basis), so this length heuristic is the
 * best available and matches observation (walk 96 → 8; eat 17 / wait 57 / jump 21 → 1). Pure.
 */
export function clipDirs(length: number): number {
  return length > 0 && length % GALLERY_DIRS === 0 ? GALLERY_DIRS : 1;
}

/**
 * The BODY bob a clip draws at a facing + animation `step` (an integer frame counter; the caller applies
 * the {@link TICKS_PER_FRAME} cadence). Cases:
 *  - **single-direction clip** (`dirs <= 1`) → the whole strip in order, IGNORING the requested facing (a
 *    non-directional animation isn't split into fake directions — fixes clicking a facing on e.g. a jump);
 *  - **8-dir + numeric facing** (a `CR_Hum_Body` block index) → that direction's `stride`-frame sub-cycle;
 *  - **8-dir + `'full'`** → rotate through all directions in COMPASS order ({@link COMPASS_TO_BLOCK}), each
 *    playing its full sub-cycle — a clean turning circle rather than the jumbled storage order.
 * Pure.
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
 * The HEAD bob to composite for a given body bob: the same offset into the clip's head base. `headStart`
 * defaults to the body `start` (head id == body id, the usual case); a borrowed head (a carry variant with
 * empty own head → the base walk head) keeps the SAME (direction, frame) offset, so the head faces the walk
 * heading while the body carries the load. Pure.
 */
export function headBobId(clip: GalleryClip, bodyBob: number): number {
  return (clip.headStart ?? clip.start) + (bodyBob - clip.start);
}
