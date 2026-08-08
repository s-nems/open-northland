import type { FrameListAnim, SettlerStateBinding, SpriteFrameRef } from '@open-northland/render';
import { ATTACK_ATOMIC } from '../../catalog/atomics.js';
import type { BobSeqRow, ContentIr, GfxAnimAtomicRow } from '../ir/rows.js';
import { eightDirAnim, frameListsByFacing } from '../settler-gfx/index.js';

// The pure animal-look binding: one tribe's `[gfxwalkatomic]` / `[gfxanimatomic]` rows at the animal jobs
// become a SettlerStateBinding over the shared `cr_ani` body sequences.

/** The animal pseudo-jobs (`jobtypes.ini` / `logicdefines.inc`: `baby_animal` 48, `adult_animal` 49). Rows
 *  are read at the adult job first, the baby lane as a defensive fallback. The lanes bind the same
 *  sequences except the wolf's action-2 wait (adult `..._wait_clean` vs baby `..._wait_cry`). */
export const ADULT_ANIMAL_JOB = 49;
const BABY_ANIMAL_JOB = 48;
const ANIMAL_JOBS = [ADULT_ANIMAL_JOB, BABY_ANIMAL_JOB] as const;

/** The idle `[gfxanimatomic]` action ladder: the animal jobs' allowed wait atomics
 *  (`jobtypes.ini` `baby_animal` `allowatomic` 2..7, 9), probed in order; every extracted animal wait
 *  row sits on one of these. */
const ANIMAL_IDLE_ACTIONS = [2, 3, 4, 5, 6, 7, 9] as const;

/** The animal's unloaded walk in the `[gfxwalkatomic]` table (`logicgoodtype 0`; animals never haul). */
const ANIMAL_WALK_GOOD_TYPE = 0;

/** The first `[gfxanimatomic]` row for `(tribe, action)` across the animal jobs, adult lane first. */
function animalGfxAtomicRow(
  ir: ContentIr | null,
  tribe: number,
  action: number,
): GfxAnimAtomicRow | undefined {
  for (const job of ANIMAL_JOBS) {
    const row = ir?.gfxAtomics?.find((r) => r.tribe === tribe && r.job === job && r.action === action);
    if (row !== undefined) return row;
  }
  return undefined;
}

/**
 * The tribe's walk `[bobseq]` name: the first `[gfxwalkatomic]` unloaded row across the animal jobs whose
 * sequence is a clean ×8 strip. The wolves/lions author a second `..._running` row; first-wins keeps the walk,
 * matching the sim's unconsumed `runspeed`.
 */
export function animalWalkSeqName(
  ir: ContentIr | null,
  tribe: number,
  seqByName: ReadonlyMap<string, BobSeqRow>,
): string | undefined {
  for (const job of ANIMAL_JOBS) {
    for (const row of ir?.gfxWalkAtomics ?? []) {
      if (row.tribe !== tribe || row.job !== job || row.goodType !== ANIMAL_WALK_GOOD_TYPE) continue;
      if (eightDirAnim(seqByName, row.bodySeq) !== undefined) return row.bodySeq;
    }
  }
  return undefined;
}

/**
 * Build one animal tribe's {@link SettlerStateBinding} from the IR lanes. Returns `null` when no idle
 * resolves, so the caller leaves the tribe unbound instead of binding a bogus range.
 *
 * The idle plays the row's authored frame-list program rather than the raw wait strip, which packs several
 * poses back-to-back. Approximations: every animal of a species breathes in lockstep, since the free tick
 * clock has no per-entity phase, and the idle probe stops at the first usable row in
 * {@link ANIMAL_IDLE_ACTIONS}, dropping the original's idle variety.
 */
export function animalBinding(
  ir: ContentIr | null,
  tribe: number,
  seqByName: ReadonlyMap<string, BobSeqRow>,
): SettlerStateBinding | null {
  const walkName = animalWalkSeqName(ir, tribe, seqByName);
  const walk = eightDirAnim(seqByName, walkName);

  let idle: SpriteFrameRef | null = null;
  for (const action of ANIMAL_IDLE_ACTIONS) {
    const row = animalGfxAtomicRow(ir, tribe, action);
    if (row === undefined) continue;
    const seq = seqByName.get(row.bodySeq);
    if (seq === undefined || seq.length <= 0) continue;
    if (row.dirFrames.every((list) => list.length === 0)) continue; // no program - nothing to play
    idle = { start: seq.start, frameLists: frameListsByFacing(row.dirFrames), loop: true };
    break;
  }
  // No authored wait: hold the walk's first frame per facing (still the right species and heading).
  idle ??= walk !== undefined ? { ...walk, frames: 1 } : null;
  if (idle === null) return null;

  let attack: FrameListAnim | undefined;
  const fight = animalGfxAtomicRow(ir, tribe, ATTACK_ATOMIC);
  if (fight !== undefined) {
    const seq = seqByName.get(fight.bodySeq);
    if (seq !== undefined && seq.length > 0 && fight.dirFrames.length > 0) {
      attack = { start: seq.start, frameLists: frameListsByFacing(fight.dirFrames) };
    }
  }

  return {
    idle,
    ...(walk !== undefined ? { moving: walk } : {}),
    ...(attack !== undefined ? { byAtomic: { [ATTACK_ATOMIC]: attack } } : {}),
  };
}
