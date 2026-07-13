/**
 * Animation frame bindings — the `[bobseq]` named frame ranges and the `[gfxanimatomic]` per-facing
 * atomic-action frame lists, both from `mapmoveableanimations/animations.ini`.
 */

import { BobSequenceSet, GfxAnimAtomic } from '@vinland/data';
import {
  findProps,
  getInt,
  getStr,
  makeSource,
  normalizeAssetPath,
  normalizeOptionalPath,
  type RuleSection,
  type SourceRef,
} from '../grammar.js';

/**
 * Extracts the `[bobseq]` records from `animations.ini` (the mod's
 * `animation/mapmoveableanimations/animations.ini`) into one {@link BobSequenceSet} per bob set — the
 * named animation ranges (`seq "<name>" <start> <length>`) the renderer previously hard-coded as magic
 * frame constants (`WALK` start 1988, `CHOP` 5106, …). Each record names its `imagelib` `.bmd` (the bob
 * set the ids index into) plus an optional `shadowlib`, and lists every sequence as a `seq` line whose
 * three values are the quoted name, the first bob id, and the total frame count across all directions.
 *
 * The render builds a directional cycle from each: `start` + `length` (with `dirs` = 8 for these
 * sprites, so the per-direction stride is `length / dirs`). The same sequence name recurs across several
 * bob sets that share a layout (`human_man_generic_walk` is 1988/96 in `CR_Hum_Body_00`, `_05`, `_10`,
 * …); each set is emitted independently so a consumer resolves by `(imagelib, name)`. `imagelib`/
 * `shadowlib` are normalized (lower-cased; they are bare `.bmd` filenames) to join case-insensitively
 * onto the decoded atlas stems. A record with no `imagelib` (nothing to index) or a `seq` line missing
 * its start/length (non-numeric) is skipped, never thrown — one malformed line must not abort the batch.
 */
export function extractBobSequences(sections: readonly RuleSection[], src: SourceRef): BobSequenceSet[] {
  const sets: BobSequenceSet[] = [];
  for (const sec of sections) {
    if (sec.name !== 'bobseq') continue;
    const imagelib = getStr(sec, 'imagelib');
    if (imagelib === undefined || imagelib.trim() === '') continue;
    const shadowlib = getStr(sec, 'shadowlib');
    const sequences: { name: string; start: number; length: number }[] = [];
    for (const p of findProps(sec, 'seq')) {
      const name = p.values[0];
      const start = Number.parseInt(p.values[1] ?? '', 10);
      const length = Number.parseInt(p.values[2] ?? '', 10);
      if (name === undefined || name.trim() === '' || Number.isNaN(start) || Number.isNaN(length)) continue;
      sequences.push({ name, start, length });
    }
    sets.push(
      BobSequenceSet.parse({
        imagelib: normalizeAssetPath(imagelib),
        shadowlib: normalizeOptionalPath(shadowlib),
        sequences,
        source: makeSource(src, 'bobseq'),
      }),
    );
  }
  return sets;
}

/**
 * Extracts the `[gfxanimatomic]` records from `mapmoveableanimations/animations.ini` into
 * {@link GfxAnimAtomic} rows — the atomic-action → directional body-animation binding the renderer needs
 * to play an ACTION (an attack swing, a work stroke) FACING its target. Unlike {@link extractBobSequences}
 * (which reads only the `[bobseq]` frame ranges), this reads the `gfxanimframelistdir <dir> <idx…>` lines
 * that lay an animation out per facing — the layout a bare `start`/`length` cannot encode (a melee swing
 * pool is not `length / 8` and authors per-facing holds/reuse; see {@link GfxAnimAtomic}).
 *
 * Each `gfxanimframelistdir` is placed at its leading `<dir>` slot so `dirFrames[d]` is facing `d`
 * regardless of file order; a record with a single non-directional `gfxanimframelist` yields one
 * facing-locked list. A record missing its tribe/job/action/body-seq, or carrying no frame list at all, is
 * skipped (never thrown) — one malformed record must not abort the batch. The same `(job, action)` recurs
 * per tribe, and one job/action may have SEVERAL records (the unarmed soldier's four punch variants); all
 * are emitted, and a consumer resolves by `(tribe, job, action)` or by `bodySeq` name.
 */
export function extractGfxAnimAtomics(sections: readonly RuleSection[], src: SourceRef): GfxAnimAtomic[] {
  const out: GfxAnimAtomic[] = [];
  for (const sec of sections) {
    if (sec.name !== 'gfxanimatomic') continue;
    const tribe = getInt(sec, 'logictribe');
    const job = getInt(sec, 'logicjob');
    const action = getInt(sec, 'logicatomicaction');
    const bodySeq = getStr(sec, 'gfxbobseqbody');
    if (
      tribe === undefined ||
      job === undefined ||
      action === undefined ||
      bodySeq === undefined ||
      bodySeq.trim() === ''
    ) {
      continue;
    }
    const headSeq = getStr(sec, 'gfxbobseqhead');
    // Per-direction frame lists: place each `gfxanimframelistdir <dir> <idx…>` at its `<dir>` slot so the
    // outer index is the facing. A missing intermediate dir stays an empty list (playback holds frame 0).
    const dirProps = findProps(sec, 'gfxanimframelistdir');
    let dirFrames: number[][];
    if (dirProps.length > 0) {
      const byDir = new Map<number, number[]>();
      for (const p of dirProps) {
        const dir = Number.parseInt(p.values[0] ?? '', 10);
        if (Number.isNaN(dir) || dir < 0) continue;
        const ids = p.values
          .slice(1)
          .map((v) => Number.parseInt(v, 10))
          .filter((n) => !Number.isNaN(n) && n >= 0);
        byDir.set(dir, ids);
      }
      if (byDir.size === 0) continue;
      const maxDir = Math.max(...byDir.keys());
      dirFrames = [];
      for (let d = 0; d <= maxDir; d++) dirFrames.push(byDir.get(d) ?? []);
    } else {
      // A non-directional record: one facing-locked list (`gfxanimframelist <idx…>` — no leading dir).
      const single = findProps(sec, 'gfxanimframelist')[0];
      if (single === undefined) continue;
      const ids = single.values.map((v) => Number.parseInt(v, 10)).filter((n) => !Number.isNaN(n) && n >= 0);
      dirFrames = [ids];
    }
    if (dirFrames.every((list) => list.length === 0)) continue; // nothing to draw
    out.push(
      GfxAnimAtomic.parse({
        tribe,
        job,
        action,
        bodySeq,
        ...(headSeq !== undefined && headSeq.trim() !== '' ? { headSeq } : {}),
        dirFrames,
        source: makeSource(src, 'gfxanimatomic'),
      }),
    );
  }
  return out;
}
