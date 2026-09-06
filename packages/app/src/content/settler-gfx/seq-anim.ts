import { type DirectionalAnim, GFX_DIR_TO_FACING } from '@open-northland/render';
import type { BobSeqRow } from '../ir/rows.js';
import { DIRS } from './sequences.js';

/**
 * Returns `fallback` verbatim when the named `[bobseq]` sequence is missing or empty, so a partial IR keeps
 * the known-good range rather than a computed bogus one.
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
    ...(extra.frames !== undefined ? { frames: extra.frames } : {}),
    ...(extra.phaseStart !== undefined ? { phaseStart: extra.phaseStart } : {}),
  };
}

/**
 * A named ×8 `[bobseq]` row as a directional animation, or `undefined` when the row is missing, empty, or
 * not a clean ×8 strip, so a malformed IR can never become a bogus frame range. When `walkLists` carries
 * the sequence's `gfxwalkframelist` lists, their authored cut wins over the whole-block reading.
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
 * Reduce a walk row's per-`<dir>` frame lists to a per-block frame cut, valid only when every facing's list
 * is the same contiguous run of `frames` starting at `facing*stride` - true of every viking human list.
 * Anything else (a few animal gaits mix run lengths across directions) returns `undefined` and the caller
 * keeps the whole-block reading, an approximation that plays block frames the list skips.
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
 * Reorder a `[gfxanimatomic]` per-`<dir>` frame-list table into the render's per-facing order. A single-list
 * table is a bare `gfxanimframelist` and plays verbatim on every facing; a sparsely authored dir leaves an
 * empty list rather than borrowing a neighbour's swing.
 */
export function frameListsByFacing(dirLists: readonly (readonly number[])[]): readonly (readonly number[])[] {
  if (dirLists.length === 1) return dirLists;
  const byFacing: (readonly number[])[] = new Array(DIRS).fill([]);
  GFX_DIR_TO_FACING.forEach((facing, dir) => {
    byFacing[facing] = dirLists[dir] ?? [];
  });
  return byFacing;
}

/** A `[bobseq]` row as a facing-locked clip, the `clipDirs` reading for a non-×8 strip; `undefined` for a
 *  missing or empty row so a caller can chain a fallback. */
export function singleDirAnim(row: BobSeqRow | undefined): DirectionalAnim | undefined {
  if (row === undefined || row.length <= 0) return undefined;
  return { start: row.start, dirs: 1, stride: row.length };
}

/** The `(typeId, id-slug)` pair the per-good carry join keys on. */
export interface GoodRef {
  readonly typeId: number;
  readonly id: string;
}
