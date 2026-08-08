/**
 * Animation frame bindings from `mapmoveableanimations/animations.ini` - the `[bobseq]` named frame
 * ranges, the `[gfxanimatomic]` per-facing atomic-action frame lists, and the `[gfxwalkatomic]`
 * good → loaded-gait table.
 */

import { BobSequenceSet, GfxAnimAtomic, GfxWalkAtomic } from '@open-northland/data';
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
 * Extracts the `[bobseq]` records from `animation/mapmoveableanimations/animations.ini` into one
 * {@link BobSequenceSet} per bob set: `imagelib` (plus optional `shadowlib`) naming the `.bmd` the ids
 * index into, and one `seq "<name>" <start> <length>` line per named range. The same sequence name
 * recurs across bob sets that share a layout, so each set is emitted independently and a consumer
 * resolves by `(imagelib, name)`. `imagelib`/`shadowlib` are bare `.bmd` filenames, lower-cased to join
 * case-insensitively onto the decoded atlas stems.
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
 * Parse the repeated `<key> <dir> <idx…>` frame-list lines of one section, placing each list at its
 * `<dir>` slot so the outer index is the direction regardless of file order. A missing intermediate dir
 * stays an empty list; `undefined` when the section carries no such key. Order and repeats are kept
 * verbatim - a repeated index is an authored hold.
 */
function dirIndexedFrameLists(sec: RuleSection, key: string): number[][] | undefined {
  const props = findProps(sec, key);
  if (props.length === 0) return undefined;
  const byDir = new Map<number, number[]>();
  for (const p of props) {
    const dir = Number.parseInt(p.values[0] ?? '', 10);
    if (Number.isNaN(dir) || dir < 0) continue;
    const ids = p.values
      .slice(1)
      .map((v) => Number.parseInt(v, 10))
      .filter((n) => !Number.isNaN(n) && n >= 0);
    byDir.set(dir, ids);
  }
  if (byDir.size === 0) return undefined;
  const maxDir = Math.max(...byDir.keys());
  const dirFrames: number[][] = [];
  for (let d = 0; d <= maxDir; d++) dirFrames.push(byDir.get(d) ?? []);
  return dirFrames;
}

/**
 * Extracts the `[gfxanimatomic]` records from `mapmoveableanimations/animations.ini` into
 * {@link GfxAnimAtomic} rows, reading the `gfxanimframelistdir <dir> <idx…>` lines that lay an animation
 * out per facing. One `(job, action)` may carry several records (the unarmed soldier's punch variants)
 * and all are emitted, so a consumer resolves by `(tribe, job, action)` or by `bodySeq` name. A record
 * missing its tribe/job/action/body-seq or carrying no frame list is skipped, never thrown.
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
    let dirFrames = dirIndexedFrameLists(sec, 'gfxanimframelistdir');
    if (dirFrames === undefined) {
      // A non-directional record: one facing-locked list (`gfxanimframelist <idx…>` - no leading dir).
      const single = findProps(sec, 'gfxanimframelist')[0];
      if (single === undefined) continue;
      const ids = single.values.map((v) => Number.parseInt(v, 10)).filter((n) => !Number.isNaN(n) && n >= 0);
      dirFrames = [ids];
    }
    if (dirFrames.every((list) => list.length === 0)) continue; // nothing to draw
    const mode = getInt(sec, 'gfxanimmode');
    out.push(
      GfxAnimAtomic.parse({
        tribe,
        job,
        action,
        bodySeq,
        ...(headSeq !== undefined && headSeq.trim() !== '' ? { headSeq } : {}),
        dirFrames,
        ...(mode !== undefined && mode >= 0 ? { mode } : {}),
        source: makeSource(src, 'gfxanimatomic'),
      }),
    );
  }
  return out;
}

/**
 * Extracts the `[gfxwalkatomic]` good → loaded-gait records from
 * `mapmoveableanimations/animations.ini`. The binding is not derivable from the good's name (honey binds
 * `..._walk_potion`, wool `..._walk_flour`). A record missing its tribe/job/good or its body seq is
 * skipped, never thrown.
 */
export function extractGfxWalkAtomics(sections: readonly RuleSection[], src: SourceRef): GfxWalkAtomic[] {
  const out: GfxWalkAtomic[] = [];
  for (const sec of sections) {
    if (sec.name !== 'gfxwalkatomic') continue;
    const tribe = getInt(sec, 'logictribe');
    const job = getInt(sec, 'logicjob');
    const goodType = getInt(sec, 'logicgoodtype');
    const bodySeq = getStr(sec, 'gfxbobseqbody');
    if (
      tribe === undefined ||
      job === undefined ||
      goodType === undefined ||
      bodySeq === undefined ||
      bodySeq.trim() === ''
    ) {
      continue;
    }
    const headSeq = getStr(sec, 'gfxbobseqhead');
    const dirFrames = dirIndexedFrameLists(sec, 'gfxwalkframelist');
    const walkSpeed = getInt(sec, 'logicwalkspeed');
    out.push(
      GfxWalkAtomic.parse({
        tribe,
        job,
        goodType,
        bodySeq,
        ...(headSeq !== undefined && headSeq.trim() !== '' ? { headSeq } : {}),
        ...(dirFrames !== undefined ? { dirFrames } : {}),
        ...(walkSpeed !== undefined && walkSpeed > 0 ? { walkSpeed } : {}),
        source: makeSource(src, 'gfxwalkatomic'),
      }),
    );
  }
  return out;
}
