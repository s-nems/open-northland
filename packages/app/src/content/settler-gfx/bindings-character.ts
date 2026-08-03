import type {
  CarryingBinding,
  DirectionalAnim,
  FrameListAnim,
  SettlerStateBinding,
  SpriteAtlas,
  SpriteFrameRef,
} from '@open-northland/render';
import { ATTACK_ATOMIC } from '../../catalog/atomics.js';
import type { BobSeqRow } from '../ir/rows.js';
import type { CharacterSpec } from './character-specs.js';
import { eightDirAnim, frameListsByFacing, type GoodRef, singleDirAnim } from './seq-anim.js';
import { DIRS } from './sequences.js';

/**
 * The per-`goodType` loaded-gait table for one body from the original's `[gfxwalkatomic]` table (good slug
 * → body bobseq for this job): `moving` is the named ×8 cycle, `idle` its first-frame hold. Keyed on the
 * running content set's `typeId`, since the slug is what survives between it and the decoded IR's id space.
 *
 * A good with no record for this job is omitted, which is the source's own answer rather than a gap: that
 * job shows no load for it. A sequence the body doesn't author, or one that isn't a clean ×8 strip, is
 * likewise skipped. Pure.
 */
export function carryAnimsByGood(
  seqByName: ReadonlyMap<string, BobSeqRow>,
  carrySeqBySlug: ReadonlyMap<string, string>,
  goods: readonly GoodRef[],
): NonNullable<CarryingBinding['byGood']> {
  const out: Record<number, { idle: SpriteFrameRef; moving: SpriteFrameRef }> = {};
  for (const good of goods) {
    const seq = carrySeqBySlug.get(good.id);
    if (seq === undefined) continue;
    const moving = eightDirAnim(seqByName, seq);
    if (moving === undefined) continue;
    out[good.typeId] = { moving, idle: { ...moving, frames: 1 } };
  }
  return out;
}

/**
 * Build one character's {@link SettlerStateBinding} from its spec and its body's decoded `[bobseq]` rows.
 * Returns `null` when neither the walk nor a loop wait resolves, so the character is dropped and its jobs
 * fall back to the default look rather than a bogus frame range. Pure.
 */
export function characterBinding(
  spec: CharacterSpec,
  seqByName: ReadonlyMap<string, BobSeqRow>,
  goods: readonly GoodRef[],
  /** The `[gfxwalkatomic]` loaded-gait table for this spec's job (good slug → body bobseq). Empty on an IR
   *  without the lane, which falls the body back to its generic loaded gait. */
  carrySeqBySlug?: ReadonlyMap<string, string>,
  attackFrameLists?: ReadonlyMap<string, readonly (readonly number[])[]>,
  /** Per-atomic `[gfxanimatomic]` frame-list tables (atomic id → seq name → per-`<dir>` lists) for the
   *  spec's {@link CharacterSpec.dirListAtomics}. */
  actionFrameLists?: ReadonlyMap<number, ReadonlyMap<string, readonly (readonly number[])[]>>,
): SettlerStateBinding | null {
  const walk = eightDirAnim(seqByName, spec.walkSeq);
  // A loop wait plays its whole strip facing-locked; otherwise idle holds the walk's first frame per facing.
  const idle: SpriteFrameRef | null =
    singleDirAnim(spec.waitSeq !== undefined ? seqByName.get(spec.waitSeq) : undefined) ??
    (walk !== undefined ? { ...walk, frames: 1 } : null);
  if (idle === null) return null;

  const byAtomic: Record<number, SpriteFrameRef> = {};
  for (const [atomicId, action] of Object.entries(spec.atomics ?? {})) {
    const row = seqByName.get(action.seq);
    if (row === undefined || row.length <= 0) continue;
    // A clean ×8 action (chop 120, pray 120) is directional; a non-×8 one (eat 17, sleep 20, pick_up 19)
    // plays its whole strip facing-locked.
    const anim: DirectionalAnim =
      row.length % DIRS === 0
        ? { start: row.start, dirs: DIRS, stride: row.length / DIRS }
        : { start: row.start, dirs: 1, stride: row.length };
    byAtomic[Number(atomicId)] = {
      ...anim,
      ...(action.phaseStart !== undefined ? { phaseStart: action.phaseStart } : {}),
      ...(action.ticksPerFrame !== undefined ? { ticksPerFrame: action.ticksPerFrame } : {}),
    };
  }

  // The attack swing: the pool's `start` from the `[bobseq]` row, its per-direction layout from the viking
  // `[gfxanimatomic]` frame lists keyed by the same seq name. Bound only when both resolve - a body or IR
  // missing either just has no attack animation, never a bogus uniform slice.
  if (spec.attack !== undefined) {
    const row = seqByName.get(spec.attack);
    const dirLists = attackFrameLists?.get(spec.attack);
    if (row !== undefined && row.length > 0 && dirLists !== undefined && dirLists.length > 0) {
      const swing: FrameListAnim = { start: row.start, frameLists: frameListsByFacing(dirLists) };
      byAtomic[ATTACK_ATOMIC] = swing;
    }
  }

  // The other frame-list actions: each binds only when both its `[bobseq]` row and its per-atomic
  // `[gfxanimatomic]` lists resolve, overriding the plain `atomics` fallback for the same id.
  for (const [atomicId, entry] of Object.entries(spec.dirListAtomics ?? {})) {
    const { seq: seqName, ticksPerFrame } =
      typeof entry === 'string' ? { seq: entry, ticksPerFrame: undefined } : entry;
    const row = seqByName.get(seqName);
    const dirLists = actionFrameLists?.get(Number(atomicId))?.get(seqName);
    if (row !== undefined && row.length > 0 && dirLists !== undefined && dirLists.length > 0) {
      byAtomic[Number(atomicId)] = {
        start: row.start,
        frameLists: frameListsByFacing(dirLists),
        ...(ticksPerFrame !== undefined ? { ticksPerFrame } : {}),
      };
    }
  }

  // The combat-engaged gait: an ×8 aggressive walk plus a facing-locked aggressive wait. A look with no
  // aggressive variant yields no `engaged` and stays on its relaxed gait while engaged.
  const engagedMoving = eightDirAnim(seqByName, spec.engaged?.moving);
  const engagedIdle = singleDirAnim(
    spec.engaged?.idle !== undefined ? seqByName.get(spec.engaged.idle) : undefined,
  );
  const engaged =
    engagedMoving !== undefined || engagedIdle !== undefined
      ? {
          ...(engagedMoving !== undefined ? { moving: engagedMoving } : {}),
          ...(engagedIdle !== undefined ? { idle: engagedIdle } : {}),
        }
      : undefined;

  // The loaded gait from the `[gfxwalkatomic]` table. Where that table covers this job it is complete - a
  // good it omits genuinely draws no load - so the `<prefix>wood` gait is the floor only for an IR without
  // the lane.
  const carryByGood = carrySeqBySlug !== undefined ? carryAnimsByGood(seqByName, carrySeqBySlug, goods) : {};
  const genericCarry =
    carrySeqBySlug === undefined || carrySeqBySlug.size === 0
      ? spec.carryPrefix !== undefined
        ? eightDirAnim(seqByName, `${spec.carryPrefix}wood`)
        : undefined
      : undefined;
  const carrying =
    genericCarry !== undefined || Object.keys(carryByGood).length > 0
      ? {
          ...(genericCarry !== undefined
            ? { moving: genericCarry, idle: { ...genericCarry, frames: 1 } }
            : {}),
          ...(Object.keys(carryByGood).length > 0 ? { byGood: carryByGood } : {}),
        }
      : undefined;

  return {
    idle,
    ...(walk !== undefined ? { moving: walk } : {}),
    ...(Object.keys(byAtomic).length > 0 ? { byAtomic } : {}),
    ...(carrying !== undefined ? { carrying } : {}),
    ...(engaged !== undefined ? { engaged } : {}),
  };
}

/**
 * The head-side twin of a per-good carry table. Most of the man's carry-walk variants ship empty head bobs
 * (19 of 27 in the real decode - the head is authored once, on the base walk), so a head drawn at the carry
 * range's own ids would vanish and a stone-hauler would walk headless. A good whose head frame is empty
 * borrows the base walk at the same (facing, frame) offset. Returns the input table by identity when
 * nothing borrows, so the caller can skip building a head binding at all. Pure.
 */
export function carryHeadAnims(
  byGood: NonNullable<CarryingBinding['byGood']>,
  walk: DirectionalAnim | undefined,
  headAtlas: SpriteAtlas,
): NonNullable<CarryingBinding['byGood']> {
  if (walk === undefined) return byGood;
  const out: Record<number, { readonly idle?: SpriteFrameRef; readonly moving?: SpriteFrameRef }> = {};
  let borrowed = false;
  for (const [goodType, slot] of Object.entries(byGood)) {
    const moving = slot.moving;
    let headAuthored = true;
    if (typeof moving === 'object') {
      const frame = headAtlas.frames.get(moving.start);
      headAuthored = frame !== undefined && frame.width > 0 && frame.height > 0;
    }
    if (headAuthored) {
      out[Number(goodType)] = slot;
    } else {
      out[Number(goodType)] = { moving: walk, idle: { ...walk, frames: 1 } };
      borrowed = true;
    }
  }
  return borrowed ? out : byGood;
}
