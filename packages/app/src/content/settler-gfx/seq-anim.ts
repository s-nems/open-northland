import type { DirectionalAnim } from '@open-northland/render';
import type { BobSeqRow } from '../ir/rows.js';
import { DIRS } from './sequences.js';

/**
 * The pure seq→anim primitives every settler binding builds on: turn a decoded `[bobseq]` row into a
 * {@link DirectionalAnim} range. Kept apart from the binding assembly (`bindings-demo.ts`,
 * `bindings-character.ts`) so the frame math is unit-tested without a browser and both binding halves
 * share one reading of "row → range".
 */

/**
 * Build a {@link DirectionalAnim} from a decoded `[bobseq]` sequence: `start` is the run's first bob id,
 * `stride = length / DIRS` (the per-direction frame count). Returns {@link fallback} verbatim when the
 * named sequence is missing (a partial/old IR), so the render keeps the known-good range rather than
 * computing a bogus one. The render-taste overrides (`frames` for a single-frame idle hold, `phaseStart`
 * for the chop windup) are applied on top of the extracted range. Pure.
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
 * A named ×8 `[bobseq]` row as a {@link DirectionalAnim}, or `undefined` when the row is missing, empty,
 * or not a clean ×8 strip — the one guard every per-character animation slot shares, so a malformed IR
 * can never become a bogus frame range. The null-on-miss twin of {@link directionalAnimFromSeq}. Pure.
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
 * `gfxanimframelistdir <dir>` index → the render facing (the `CR_Hum_Body` strip-block order
 * `0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S, 7 N` — source basis "Settler facing"). The source's `<dir>`
 * space is the engine's movement-direction ring: the staggered-lattice hex neighbours clockwise from
 * screen-east (`0 E, 1 SE, 2 SW, 3 W, 4 NW, 5 NE`) plus the two row-crossing verticals (`6 N, 7 S`).
 * Data-pinned: across every extracted human character-body `[gfxanimatomic]` record whose strip is a
 * uniform ×8 block layout (`human_*`, the bodies these warrior bindings draw), each dir-`d` frame list
 * indexes exclusively into strip block `GFX_DIR_TO_BLOCK[d]`. Indexing frame lists by facing without this
 * remap draws the NW swing on an east-facing attacker. The animal `[gfxanimatomic]` tables ride the
 * same remap by analogy (their strips are not all uniform ×8); the wildlife scene is its eyes-check.
 */
const GFX_DIR_TO_BLOCK = [4, 5, 0, 1, 2, 3, 7, 6] as const;

/**
 * Reorder a `[gfxanimatomic]` per-`<dir>` frame-list table into the render's per-facing order (a
 * {@link import('@open-northland/render').FrameListAnim}'s `frameLists` is indexed by facing). A
 * single-list table is facing-locked (a bare `gfxanimframelist`) and plays verbatim on every facing.
 * Any multi-list table lives in the `<dir>` space and is remapped — including a partial one (dirs
 * authored sparsely): each authored dir lands on its facing, and an unauthored slot stays an empty
 * list (`frameOf` then holds the pool's first frame for that facing rather than borrowing a
 * neighbour's swing). Pure.
 */
export function frameListsByFacing(dirLists: readonly (readonly number[])[]): readonly (readonly number[])[] {
  if (dirLists.length === 1) return dirLists; // facing-locked single list — no direction table to remap
  const byFacing: (readonly number[])[] = new Array(DIRS).fill([]);
  GFX_DIR_TO_BLOCK.forEach((facing, dir) => {
    byFacing[facing] = dirLists[dir] ?? [];
  });
  return byFacing;
}

/**
 * A `[bobseq]` row as a facing-locked clip (`dirs: 1`, the whole strip played on one facing) — the
 * `clipDirs` reading for a non-×8 strip (a wait/idle, the aggressive ready stance). `undefined` for a
 * missing/empty row so a caller can chain a fallback. The single-direction twin of {@link eightDirAnim};
 * takes the row directly since its callers already hold it. Pure.
 */
export function singleDirAnim(row: BobSeqRow | undefined): DirectionalAnim | undefined {
  if (row === undefined || row.length <= 0) return undefined;
  return { start: row.start, dirs: 1, stride: row.length };
}

/**
 * A good the loaded content set defines — the `(typeId, id-slug)` pair the per-good carry join keys on.
 * Passed by the entry that knows which content the sim runs (the live slice's demo goods, a scene's own
 * goods), since the render binding is per-`goodType` number and those ids are content-relative.
 */
export interface GoodRef {
  readonly typeId: number;
  readonly id: string;
}
