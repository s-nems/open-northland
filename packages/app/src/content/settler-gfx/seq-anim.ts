import type { DirectionalAnim } from '@open-northland/render';
import type { BobSeqRow } from '../ir.js';
import { DIRS } from './sequences.js';

/**
 * The pure seq→anim primitives every settler binding builds on: turn a decoded `[bobseq]` row into a
 * {@link DirectionalAnim} range. Kept apart from the binding assembly (`bindings-demo.ts`,
 * `bindings-character.ts`) so the frame math is unit-tested without a browser and both binding halves
 * share ONE reading of "row → range".
 */

/**
 * Build a {@link DirectionalAnim} from a decoded `[bobseq]` sequence: `start` is the run's first bob id,
 * `stride = length / DIRS` (the per-direction frame count). Returns {@link fallback} verbatim when the
 * named sequence is missing from the manifest (a partial/old IR), so the render keeps the known-good
 * range rather than computing a bogus one. The render-taste overrides (`frames` for a single-frame idle
 * hold, `phaseStart` for the chop windup) are applied on top of the extracted range. Pure + exported so
 * the seq→frame math is unit-tested without a browser.
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
 * A named ×8 `[bobseq]` row as a {@link DirectionalAnim}, or `undefined` when the row is missing,
 * empty, or not a clean ×8 strip — the one guard every per-character animation slot shares, so a
 * malformed/partial IR can never become a bogus frame range. The null-on-miss twin of
 * {@link directionalAnimFromSeq} (which serves the legacy binding's fallback-required contract). Pure.
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
 * A `[bobseq]` row as a FACING-LOCKED clip (`dirs: 1`, the whole strip played on one facing) — the
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
 * Passed by the entry that KNOWS which content the sim runs (the live slice's demo goods, a scene's own
 * goods), since the render binding is per-`goodType` NUMBER and those ids are content-relative.
 */
export interface GoodRef {
  readonly typeId: number;
  readonly id: string;
}
