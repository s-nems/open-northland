import {
  type CarryingBinding,
  type DirectionalAnim,
  type FrameListAnim,
  type SettlerStateBinding,
  type SpriteAtlas,
  type SpriteFrameRef,
  subClipKey,
} from '@open-northland/render';
import { ATTACK_ATOMIC } from '../../catalog/atomics.js';
import { GFX_ANIM_MODE_LOOP, type GfxAtomicProgram, type TribeJobSeqs } from '../ir/joins.js';
import type { BobSeqRow, GfxAnimAtomicRow } from '../ir/rows.js';
import type { CharacterSpec } from './character-specs.js';
import { eightDirAnim, frameListsByFacing, type GoodRef, singleDirAnim } from './seq-anim.js';
import { DIRS } from './sequences.js';

/** The extracted `[gfxanimatomic]` / `[gfxwalkatomic]` tables a character binding draws from. Every
 *  member is optional: an IR without a lane degrades that slot to its bobseq-strip fallback. */
export interface CharacterGfx {
  /** The loaded-gait table for this spec's job (good slug → body bobseq). */
  readonly carrySeqBySlug?: ReadonlyMap<string, string>;
  /** Every `[gfxanimatomic]` program of the tribe: action → body seq name → program. */
  readonly programsByAction?: ReadonlyMap<number, ReadonlyMap<string, GfxAtomicProgram>>;
  /** The standing-wait program per wait bobseq name (the `gfxanimmode 1` base wait preferred). */
  readonly waitBySeq?: ReadonlyMap<string, GfxAtomicProgram>;
  /** The `gfxwalkframelist` lists per walk bobseq name. */
  readonly walkLists?: ReadonlyMap<string, readonly (readonly number[])[]>;
  /** The tribe's `logicinhouseatomicsubid` records - the clips an indoor craft program plays. */
  readonly subClips?: readonly GfxAnimAtomicRow[];
  /** The clips this tribe's own records name for the spec's job, taken where the body does not draw the
   *  transcribed viking one. */
  readonly tribeSeqs?: TribeJobSeqs;
  /** The body's own bob pool, consulted for a frame a program addresses past its `[bobseq]` row. */
  readonly bodyAtlas?: SpriteAtlas;
}

/** The transcribed clip when this body draws it, else the one this tribe's own records name. Approximation:
 *  the viking transcription wins because it separates the relaxed gait from the aggressive one, which a
 *  single `[gfxwalkatomic]` row cannot, so a tribe whose own record names a different clip for a body that
 *  draws both keeps the transcribed one (the saracen sword and spear looks). */
function pickSeq(
  seqByName: ReadonlyMap<string, BobSeqRow>,
  transcribed: string | undefined,
  authored: string | undefined,
): string | undefined {
  if (transcribed !== undefined && seqByName.has(transcribed)) return transcribed;
  if (authored !== undefined && seqByName.has(authored)) return authored;
  return transcribed;
}

/**
 * The per-`goodType` loaded gait for one body, from the original's `[gfxwalkatomic]` table. Keyed on the
 * running content set's `typeId`, since the slug is what survives between it and the decoded IR's id space.
 * A good with no record for this job is omitted, which is the source's own answer rather than a gap: that
 * job shows no load for it.
 */
export function carryAnimsByGood(
  seqByName: ReadonlyMap<string, BobSeqRow>,
  carrySeqBySlug: ReadonlyMap<string, string>,
  goods: readonly GoodRef[],
  walkLists?: ReadonlyMap<string, readonly (readonly number[])[]>,
): NonNullable<CarryingBinding['byGood']> {
  const out: Record<number, { idle: SpriteFrameRef; moving: SpriteFrameRef }> = {};
  for (const good of goods) {
    const seq = carrySeqBySlug.get(good.id);
    if (seq === undefined) continue;
    const moving = eightDirAnim(seqByName, seq, walkLists);
    if (moving === undefined) continue;
    out[good.typeId] = { moving, idle: { ...moving, frames: 1 } };
  }
  return out;
}

/**
 * Whether every frame a program addresses is a bob the body draws. An offset inside the row is drawable by
 * construction, since the rows come from {@link playableSequences}; one past it has to be proven, because a
 * program can outrun its row in either direction. Four human attack records lay out a full eight facings
 * against a row declaring six and the extra frames are drawn, while a tribe naming a clip a shorter body
 * carries runs off its pool into blank bobs, which the renderer draws as the missing-sprite placeholder.
 */
function drawsProgram(
  program: GfxAtomicProgram | undefined,
  row: BobSeqRow,
  atlas: SpriteAtlas | undefined,
): program is GfxAtomicProgram {
  if (program === undefined || row.length <= 0) return false;
  for (const list of program.dirFrames) {
    for (const offset of list) {
      if (offset < row.length) continue;
      const frame = atlas?.frames.get(row.start + offset);
      if (frame === undefined || frame.width === 0 || frame.height === 0) return false;
    }
  }
  return true;
}

/**
 * A wait bobseq's authored standing program, looping. Approximation: a program without the `gfxanimmode 1`
 * mark is a one-shot fidget, looped anyway because freezing after one play would read as a stuck sprite.
 */
function waitListAnim(
  name: string | undefined,
  seqByName: ReadonlyMap<string, BobSeqRow>,
  waitBySeq: ReadonlyMap<string, GfxAtomicProgram> | undefined,
  atlas: SpriteAtlas | undefined,
): FrameListAnim | undefined {
  if (name === undefined) return undefined;
  const program = waitBySeq?.get(name);
  const row = seqByName.get(name);
  if (row === undefined || !drawsProgram(program, row, atlas)) return undefined;
  return { start: row.start, frameLists: frameListsByFacing(program.dirFrames), loop: true };
}

/**
 * The indoor craft clips this body carries, keyed by `(action, subId)`. A record naming a sequence some
 * other body owns is skipped, which is what scopes the tribe-wide table to each character. The key omits
 * the job because the source gives each trade its own production actions, so no two collide.
 */
function subClipAnims(
  subClips: readonly GfxAnimAtomicRow[],
  seqByName: ReadonlyMap<string, BobSeqRow>,
): Record<string, SpriteFrameRef> {
  const out: Record<string, SpriteFrameRef> = {};
  for (const row of subClips) {
    if (row.subId === undefined) continue;
    const seq = seqByName.get(row.bodySeq);
    if (seq === undefined || seq.length <= 0) continue;
    out[subClipKey(row.action, row.subId)] = {
      start: seq.start,
      frameLists: frameListsByFacing(row.dirFrames),
    };
  }
  return out;
}

/**
 * Build one character's binding from its spec, its body's decoded `[bobseq]` rows, and the extracted
 * animation tables. Every slot prefers the authored program, whose frame lists carry holds, facings, and
 * cuts a bare bobseq range cannot encode, and falls back to the raw strip when the IR carries none.
 * Returns `null` when neither the walk nor a wait resolves, so the character is dropped and its jobs draw
 * the default look rather than a bogus frame range.
 */
export function characterBinding(
  spec: CharacterSpec,
  seqByName: ReadonlyMap<string, BobSeqRow>,
  goods: readonly GoodRef[],
  gfx: CharacterGfx = {},
): SettlerStateBinding | null {
  const { carrySeqBySlug, programsByAction, waitBySeq, walkLists, tribeSeqs, bodyAtlas, subClips } = gfx;
  const walkSeq = pickSeq(seqByName, spec.walkSeq, tribeSeqs?.walk);
  const waitSeq = pickSeq(seqByName, spec.waitSeq, tribeSeqs?.wait);
  const walk = eightDirAnim(seqByName, walkSeq, walkLists);
  const idle: SpriteFrameRef | null =
    waitListAnim(waitSeq, seqByName, waitBySeq, bodyAtlas) ??
    singleDirAnim(waitSeq !== undefined ? seqByName.get(waitSeq) : undefined) ??
    (walk !== undefined ? { ...walk, frames: 1 } : null);
  if (idle === null) return null;

  const byAtomic: Record<number, SpriteFrameRef> = {};
  for (const [atomicId, action] of Object.entries(spec.atomics ?? {})) {
    const row = seqByName.get(action.seq);
    if (row === undefined || row.length <= 0) continue;
    const program = programsByAction?.get(Number(atomicId))?.get(action.seq);
    if (drawsProgram(program, row, bodyAtlas)) {
      byAtomic[Number(atomicId)] = {
        start: row.start,
        frameLists: frameListsByFacing(program.dirFrames),
        ...(program.mode === GFX_ANIM_MODE_LOOP || action.loop === true ? { loop: true } : {}),
        ...(action.ticksPerFrame !== undefined ? { ticksPerFrame: action.ticksPerFrame } : {}),
      };
      continue;
    }
    // Strip fallback for a sequence the source authors no frame list for, such as the woman and child
    // meals.
    const anim: DirectionalAnim =
      row.length % DIRS === 0
        ? { start: row.start, dirs: DIRS, stride: row.length / DIRS }
        : { start: row.start, dirs: 1, stride: row.length };
    byAtomic[Number(atomicId)] = {
      ...anim,
      ...(action.phaseStart !== undefined ? { phaseStart: action.phaseStart } : {}),
      ...(action.ticksPerFrame !== undefined ? { ticksPerFrame: action.ticksPerFrame } : {}),
      ...(action.loop === true ? { loop: true } : {}),
    };
  }

  // The attack swing binds only when both the `[bobseq]` row and the action-81 frame lists resolve, so a
  // body or IR missing either has no attack animation rather than a bogus uniform slice.
  const attackSeq = pickSeq(seqByName, spec.attack, tribeSeqs?.attack);
  if (attackSeq !== undefined) {
    const row = seqByName.get(attackSeq);
    const program = programsByAction?.get(ATTACK_ATOMIC)?.get(attackSeq);
    if (row !== undefined && drawsProgram(program, row, bodyAtlas)) {
      const swing: FrameListAnim = { start: row.start, frameLists: frameListsByFacing(program.dirFrames) };
      byAtomic[ATTACK_ATOMIC] = swing;
    }
  }

  const engagedMoving = eightDirAnim(seqByName, spec.engaged?.moving, walkLists);
  const engagedIdle =
    waitListAnim(spec.engaged?.idle, seqByName, waitBySeq, bodyAtlas) ??
    singleDirAnim(spec.engaged?.idle !== undefined ? seqByName.get(spec.engaged.idle) : undefined);
  const engaged =
    engagedMoving !== undefined || engagedIdle !== undefined
      ? {
          ...(engagedMoving !== undefined ? { moving: engagedMoving } : {}),
          ...(engagedIdle !== undefined ? { idle: engagedIdle } : {}),
        }
      : undefined;

  // The `<prefix>wood` gait is the floor only for an IR with no `[gfxwalkatomic]` lane; where that table
  // covers this job it is complete.
  const carryByGood =
    carrySeqBySlug !== undefined ? carryAnimsByGood(seqByName, carrySeqBySlug, goods, walkLists) : {};
  const genericCarry =
    carrySeqBySlug === undefined || carrySeqBySlug.size === 0
      ? spec.carryPrefix !== undefined
        ? eightDirAnim(seqByName, `${spec.carryPrefix}wood`, walkLists)
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

  const bySubClip = subClips !== undefined ? subClipAnims(subClips, seqByName) : {};

  return {
    idle,
    ...(walk !== undefined ? { moving: walk } : {}),
    ...(Object.keys(byAtomic).length > 0 ? { byAtomic } : {}),
    ...(Object.keys(bySubClip).length > 0 ? { bySubClip } : {}),
    ...(carrying !== undefined ? { carrying } : {}),
    ...(engaged !== undefined ? { engaged } : {}),
  };
}

/**
 * The head-side twin of a per-good carry table. Most of the man's carry-walk variants ship empty head bobs
 * (19 of 27 in the real decode; the head is authored once, on the base walk), so a good whose head frame is
 * empty borrows the base walk at the same (facing, frame) offset instead of walking headless. Returns the
 * input table by identity when nothing borrows.
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
