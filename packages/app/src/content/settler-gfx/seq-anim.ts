import type { DirectionalAnim } from '@open-northland/render';
import type { BobSeqRow } from '../ir/rows.js';
import { DIRS } from './sequences.js';

// The `[bobseq]` row → {@link DirectionalAnim} primitives the settler binding assemblers share.

/**
 * Build a {@link DirectionalAnim} from a decoded `[bobseq]` sequence: `start` is the run's first bob id and
 * `stride = length / DIRS`. Returns {@link fallback} verbatim when the named sequence is missing, so a
 * partial IR keeps the known-good range rather than a computed bogus one.
 */
export function directionalAnimFromSeq(
  seqByName: ReadonlyMap<string, BobSeqRow>,
  name: string,
  extra: { readonly frames?: number; readonly phaseStart?: number },
  fallback: DirectionalAnim,
): DirectionalAnim {
  const seq = seqByName.get(name);
  if (seq === undefined || seq.length <= 0) return fallback;
  return {
    start: seq.start,
    dirs: DIRS,
    stride: Math.floor(seq.length / DIRS),
    // exactOptionalPropertyTypes: only set an optional key when it has a value.
    ...(extra.frames !== undefined ? { frames: extra.frames } : {}),
    ...(extra.phaseStart !== undefined ? { phaseStart: extra.phaseStart } : {}),
  };
}

/**
 * A named ×8 `[bobseq]` row as a {@link DirectionalAnim}, or `undefined` when the row is missing, empty, or
 * not a clean ×8 strip, so a malformed IR can never become a bogus frame range.
 */
export function eightDirAnim(
  seqByName: ReadonlyMap<string, BobSeqRow>,
  name: string | undefined,
): DirectionalAnim | undefined {
  if (name === undefined) return undefined;
  const row = seqByName.get(name);
  if (row === undefined || row.length <= 0 || row.length % DIRS !== 0) return undefined;
  return { start: row.start, dirs: DIRS, stride: row.length / DIRS };
}

/**
 * `gfxanimframelistdir <dir>` index → the render facing. The `CR_Hum_Body` strip-block order is
 * `0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S, 7 N` (source basis "Settler facing"); the source's `<dir>` space
 * is the engine's movement-direction ring, `0 E, 1 SE, 2 SW, 3 W, 4 NW, 5 NE` plus the row-crossing
 * verticals `6 N, 7 S`. Data-pinned: in every extracted human-body `[gfxanimatomic]` record with a uniform
 * ×8 strip, each dir-`d` frame list indexes exclusively into strip block `GFX_DIR_TO_BLOCK[d]`. The animal
 * tables ride the same remap by analogy.
 */
const GFX_DIR_TO_BLOCK = [4, 5, 0, 1, 2, 3, 7, 6] as const;

/**
 * Reorder a `[gfxanimatomic]` per-`<dir>` frame-list table into the render's per-facing order. A
 * single-list table is facing-locked (a bare `gfxanimframelist`) and plays verbatim on every facing; any
 * multi-list table lives in the `<dir>` space and is remapped, a sparsely authored dir leaving an empty
 * list rather than borrowing a neighbour's swing.
 */
export function frameListsByFacing(dirLists: readonly (readonly number[])[]): readonly (readonly number[])[] {
  if (dirLists.length === 1) return dirLists; // facing-locked single list
  const byFacing: (readonly number[])[] = new Array(DIRS).fill([]);
  GFX_DIR_TO_BLOCK.forEach((facing, dir) => {
    byFacing[facing] = dirLists[dir] ?? [];
  });
  return byFacing;
}

/**
 * A `[bobseq]` row as a facing-locked clip (`dirs: 1`, the whole strip played on one facing) - the
 * `clipDirs` reading for a non-×8 strip. `undefined` for a missing/empty row so a caller can chain a
 * fallback.
 */
export function singleDirAnim(row: BobSeqRow | undefined): DirectionalAnim | undefined {
  if (row === undefined || row.length <= 0) return undefined;
  return { start: row.start, dirs: 1, stride: row.length };
}

/** A good the loaded content set defines: the `(typeId, id-slug)` pair the per-good carry join keys on. */
export interface GoodRef {
  readonly typeId: number;
  readonly id: string;
}
