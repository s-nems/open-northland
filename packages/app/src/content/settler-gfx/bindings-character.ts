import type {
  CarryingBinding,
  DirectionalAnim,
  FrameListAnim,
  SettlerStateBinding,
  SpriteAtlas,
  SpriteFrameRef,
} from '@open-northland/render';
import { ATTACK_ATOMIC } from '../../catalog/atomics.js';
import type { BobSeqRow } from '../ir.js';
import type { CharacterSpec } from './character-specs.js';
import { eightDirAnim, type GoodRef, singleDirAnim } from './seq-anim.js';
import { DIRS } from './sequences.js';

/**
 * `gfxanimframelistdir <dir>` index → the render facing (the `CR_Hum_Body` strip-block order
 * `0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S, 7 N` — source basis "Settler facing"). The source's `<dir>`
 * space is the engine's movement-direction ring: the staggered-lattice hex neighbours clockwise from
 * screen-east (`0 E, 1 SE, 2 SW, 3 W, 4 NW, 5 NE`) plus the two row-crossing verticals (`6 N, 7 S`).
 * Data-pinned: across every extracted human character-body `[gfxanimatomic]` record whose strip is a
 * uniform ×8 block layout (`human_*`, the bodies these warrior bindings draw), each dir-`d` frame list
 * indexes exclusively into strip block `GFX_DIR_TO_BLOCK[d]`. Indexing frame lists by facing without this
 * remap draws the NW swing on an east-facing attacker.
 */
const GFX_DIR_TO_BLOCK = [4, 5, 0, 1, 2, 3, 7, 6] as const;

/**
 * Reorder a `[gfxanimatomic]` per-`<dir>` frame-list table into the render's per-facing order (a
 * {@link FrameListAnim}'s `frameLists` is indexed by facing). A single-list table is facing-locked
 * (a bare `gfxanimframelist`) and plays verbatim on every facing. Any multi-list table lives in the
 * `<dir>` space and is remapped — including a partial one (dirs authored sparsely): each authored dir
 * lands on its facing, and an unauthored slot stays an empty list (`frameOf` then holds the pool's
 * first frame for that facing rather than borrowing a neighbour's swing). Pure.
 */
function frameListsByFacing(dirLists: readonly (readonly number[])[]): readonly (readonly number[])[] {
  if (dirLists.length === 1) return dirLists; // facing-locked single list — no direction table to remap
  const byFacing: (readonly number[])[] = new Array(DIRS).fill([]);
  GFX_DIR_TO_BLOCK.forEach((facing, dir) => {
    byFacing[facing] = dirLists[dir] ?? [];
  });
  return byFacing;
}

/**
 * Build the per-`goodType` loaded-gait table for one body from the original's `[gfxwalkatomic]` table
 * ({@link import('../ir.js').carryWalkSeqs}, good slug → body bobseq for this job): bind `moving` to the
 * named ×8 cycle and `idle` to its first-frame hold (the still loaded pose a depositor stands in). The
 * result is keyed on the RUNNING content set's `typeId` — `carrySeqBySlug` is in the decoded IR's
 * id-space, and the slug is what survives between the two (the sandbox's honey is not the IR's honey).
 *
 * A good with no record for this job is omitted, which is the source's own answer rather than a gap: it
 * shows no load for that good (a soldier binds its empty walk for every good). A named sequence the body
 * doesn't author, or one that isn't a clean ×8 strip, is likewise skipped. Pure.
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
 * Build one character's {@link SettlerStateBinding} from its spec + its body's decoded `[bobseq]` rows:
 * walk → `moving`, the wait (loop or walk-hold) → `idle`, the spec's atomics → `byAtomic`, and the
 * per-good carry table → `carrying`. Returns `null` when neither the walk nor a loop wait resolves (an
 * IR predating this body's sequences) — the character is then dropped and its jobs fall back to the
 * default look, never a bogus frame range. Pure.
 */
export function characterBinding(
  spec: CharacterSpec,
  seqByName: ReadonlyMap<string, BobSeqRow>,
  goods: readonly GoodRef[],
  /** The `[gfxwalkatomic]` loaded-gait table for this spec's job (good slug → body bobseq). Empty on an
   *  IR without the lane, which falls the body back to its generic loaded gait. */
  carrySeqBySlug?: ReadonlyMap<string, string>,
  attackFrameLists?: ReadonlyMap<string, readonly (readonly number[])[]>,
  /** Per-atomic `[gfxanimatomic]` frame-list tables (atomic id → seq name → per-`<dir>` lists) for the
   *  spec's {@link CharacterSpec.dirListAtomics} — the attack mechanism generalized (farmer clips). */
  actionFrameLists?: ReadonlyMap<number, ReadonlyMap<string, readonly (readonly number[])[]>>,
): SettlerStateBinding | null {
  const walk = eightDirAnim(seqByName, spec.walkSeq);
  // A loop wait plays its whole strip facing-locked (the strips aren't ×8); a walk-hold stands the
  // walk's first frame per facing. Whichever resolves becomes idle; neither → the character is unusable.
  const idle: SpriteFrameRef | null =
    singleDirAnim(spec.waitSeq !== undefined ? seqByName.get(spec.waitSeq) : undefined) ??
    (walk !== undefined ? { ...walk, frames: 1 } : null);
  if (idle === null) return null;

  const byAtomic: Record<number, SpriteFrameRef> = {};
  for (const [atomicId, action] of Object.entries(spec.atomics ?? {})) {
    const row = seqByName.get(action.seq);
    if (row === undefined || row.length <= 0) continue;
    // A clean ×8 action (the chop 120, the pray 120) is directional; a non-×8 one (eat 17, sleep 20,
    // pick_up 19) plays its whole strip facing-locked — the same `clipDirs` reading the waits use.
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

  // The combat attack swing → a FrameListAnim on {@link ATTACK_ATOMIC}: the swing pool's `start` from the
  // `[bobseq]` row, its per-direction layout from the extracted viking `[gfxanimatomic]` frame lists
  // (keyed by the same seq name), reordered from the source's <dir> space into the render's facing order
  // ({@link frameListsByFacing}). Bound only when both resolve — a body/IR missing either just has no
  // attack animation (the unit stands its ready pose mid-swing), never a bogus uniform slice.
  if (spec.attack !== undefined) {
    const row = seqByName.get(spec.attack);
    const dirLists = attackFrameLists?.get(spec.attack);
    if (row !== undefined && row.length > 0 && dirLists !== undefined && dirLists.length > 0) {
      const swing: FrameListAnim = { start: row.start, frameLists: frameListsByFacing(dirLists) };
      byAtomic[ATTACK_ATOMIC] = swing;
    }
  }

  // The frame-list actions beyond the attack (the farmer's field clips): each binds only when both its
  // `[bobseq]` row and its per-atomic `[gfxanimatomic]` lists resolve, overriding any plain `atomics`
  // fallback for the same id — missing data leaves that fallback (or nothing) in place, never a bogus
  // uniform slice. Same reorder into facing space as the attack swing.
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

  // The combat-engaged gait: the aggressive walk (a clean ×8 cycle) + the aggressive wait (a facing-locked
  // strip, like the relaxed wait). Each slot is bound only when its seq resolves; a look with no
  // aggressive variant (the unarmed body, civilians) yields no `engaged` and falls back to its relaxed
  // gait while engaged.
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

  // The loaded gait, from the original's own `[gfxwalkatomic]` table. When that table covers this job,
  // it is complete: a good it omits genuinely draws no load, so no generic fallback is applied — one
  // would put a wood log in the hands of every good the table leaves out. The `<prefix>wood` gait is the
  // floor only for an IR without the lane, where the alternative is hauling nothing at all.
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
 * The head-side twin of a per-good carry table: which anim the head overlay resolves through per good.
 * Most of the man's carry-walk variants ship empty head bobs (19 of 27 in the real decode — the
 * head is authored once, on the base walk), so a head drawn at the carry range's own ids would vanish:
 * a stone-hauler would walk headless. For each good this checks the head atlas at the carry cycle's
 * first frame — authored → the good keeps its own range; empty → the head borrows the base walk at
 * the same (facing, frame) offset, exactly the gallery's proven head-reuse rule (source basis
 * "Character animation gallery"). Returns the input table by identity when nothing borrows (no walk to
 * borrow, or every head is authored), so the caller can skip building a head binding at all. Pure.
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
