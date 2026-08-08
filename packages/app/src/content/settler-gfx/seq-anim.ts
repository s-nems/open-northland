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
 * not a clean ×8 strip, so a malformed IR can never become a bogus frame range. When `walkLists` carries
 * the sequence's `gfxwalkframelist` lists, their authored cut wins over the whole-block reading. Pure.
 */
export function eightDirAnim(
  seqByName: ReadonlyMap<string, BobSeqRow>,
  name: string | undefined,
  walkLists?: ReadonlyMap<string, readonly (readonly number[])[]>,
): DirectionalAnim | undefined {
  if (name === undefined) return undefined;
  const row = seqByName.get(name);
  if (row === undefined || row.length <= 0 || row.length % DIRS !== 0) return undefined;
  const lists = walkLists?.get(name);
  if (lists !== undefined) {
    const fromLists = blockAnimFromLists(row, lists);
    if (fromLists !== undefined) return fromLists;
  }
  return { start: row.start, dirs: DIRS, stride: row.length / DIRS };
}

/**
 * Reduce a walk row's per-`<dir>` frame lists to a {@link DirectionalAnim} cutting {@link
 * DirectionalAnim.frames} frames out of each block. Valid only when every facing's list is the same
 * contiguous run `facing*stride .. facing*stride + frames - 1` - true of every viking human list.
 * Anything else (a few animal gaits mix run lengths across directions) returns `undefined` and the
 * caller keeps the whole-block reading, an approximation that plays block frames the list skips. Pure.
 */
function blockAnimFromLists(
  row: BobSeqRow,
  dirLists: readonly (readonly number[])[],
): DirectionalAnim | undefined {
  const byFacing = frameListsByFacing(dirLists);
  if (byFacing.length !== DIRS) return undefined;
  const stride = row.length / DIRS;
  const frames = byFacing[0]?.length ?? 0;
  if (frames <= 0 || frames > stride) return undefined;
  for (let facing = 0; facing < DIRS; facing++) {
    const list = byFacing[facing];
    if (list === undefined || list.length !== frames) return undefined;
    for (let i = 0; i < frames; i++) {
      if (list[i] !== facing * stride + i) return undefined;
    }
  }
  return { start: row.start, dirs: DIRS, stride, ...(frames < stride ? { frames } : {}) };
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
