import { type DirectionalAnim, GFX_DIR_TO_FACING } from '@open-northland/render/data';
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
 * Anything else returns `undefined` and {@link eightDirAnim} keeps the whole-block reading, an
 * approximation that plays block frames the list skips; the animal gaits keep such lists as frame lists.
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

/** Render facings in the `CR_Hum_Body` strip-block order ({@link GFX_DIR_TO_FACING}). */
export const FACING = { SW: 0, W: 1, NW: 2, NE: 3, E: 4, SE: 5, S: 6, N: 7 } as const;
/** A six-block clip lays out the hex facings only; S and N, the row-crossing verticals, own no block. */
export const HEX_FACINGS = 6;
/** The hex neighbour whose list a sound vertical list copies in most of the source's six-block records. */
const VERTICAL_NEIGHBOUR: Readonly<Record<number, number>> = { [FACING.S]: FACING.SE, [FACING.N]: FACING.NW };

function inBlock(list: readonly number[], block: number, size: number): boolean {
  return list.length > 0 && list.every((offset) => offset >= block * size && offset < (block + 1) * size);
}

/** The block size of a six-block clip whose hex facings each cut their own block, one facing apart at most. */
function hexBlockSize(byFacing: readonly (readonly number[])[], rowLength: number): number | undefined {
  if (rowLength % HEX_FACINGS !== 0) return undefined;
  const size = rowLength / HEX_FACINGS;
  let sound = 0;
  for (let facing = 0; facing < HEX_FACINGS; facing++) {
    if (inBlock(byFacing[facing] ?? [], facing, size)) sound++;
  }
  return sound >= HEX_FACINGS - 1 ? size : undefined;
}

/** A run that only moves forward: a strip cut, as opposed to a list composed back and forth. */
function isStripCut(list: readonly number[]): boolean {
  return list.every((offset, i) => i === 0 || offset >= (list[i - 1] ?? offset));
}

/**
 * A `[gfxanimatomic]` program's per-facing lists over its `rowLength`-frame clip, the source's slipped lists
 * in a six-block clip repaired. A strip cut that leaves its facing's block plays a neighbouring facing's or
 * another clip's frames: the viking unarmed punch reaches past its six blocks into the soldier lying down to
 * sleep at N and S, and the longbow shot into the meal at S. A hex facing's slip takes the list this program
 * cuts inside that facing's block, a vertical's its {@link VERTICAL_NEIGHBOUR}'s. Departure: the source
 * data draws those facings as authored; the byzantine record of the civilian punch lays the same clip's N
 * and S out in-block where the viking one slips.
 */
export function programFrameLists(
  dirLists: readonly (readonly number[])[],
  rowLength: number,
): readonly (readonly number[])[] {
  const byFacing = frameListsByFacing(dirLists);
  if (byFacing.length !== DIRS) return byFacing;
  const size = hexBlockSize(byFacing, rowLength);
  if (size === undefined) return byFacing;
  // A hex facing cuts its own block; a vertical may cut any one block.
  const soundIn = (list: readonly number[], facing: number): boolean => {
    const block = facing < HEX_FACINGS ? facing : Math.floor((list[0] ?? 0) / size);
    return block < HEX_FACINGS && inBlock(list, block, size);
  };
  return byFacing.map((list, facing) => {
    if (list.length === 0 || !isStripCut(list) || soundIn(list, facing)) return list;
    const neighbour = VERTICAL_NEIGHBOUR[facing];
    const borrowed =
      facing < HEX_FACINGS
        ? byFacing.find((other) => inBlock(other, facing, size))
        : neighbour !== undefined
          ? byFacing[neighbour]
          : undefined;
    return borrowed !== undefined && soundIn(borrowed, facing) ? borrowed : list;
  });
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
