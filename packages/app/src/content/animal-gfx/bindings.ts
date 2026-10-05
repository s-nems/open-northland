import type {
  DirectionalAnim,
  FrameListAnim,
  SettlerStateBinding,
  SpriteFrameRef,
} from '@open-northland/render';
import { ANIMAL_EXTRA_ANIMATIONS } from '../../catalog/animal-animation-extras.js';
import { ATTACK_ATOMIC } from '../../catalog/atomics.js';
import { GFX_ANIM_MODE_LOOP, gfxWalkFrameLists } from '../ir/joins.js';
import type { BobSeqRow, ContentIr, GfxAnimAtomicRow } from '../ir/rows.js';
import { eightDirAnim, frameListsByFacing, IDLE_ACTIONS } from '../settler-gfx/index.js';

import { animalExtraIdle } from './extras.js';

// The pure animal-look binding: one tribe's `[gfxwalkatomic]` / `[gfxanimatomic]` rows at the animal jobs
// become a SettlerStateBinding over the shared `cr_ani` body sequences.

/** The animal pseudo-jobs (`jobtypes.ini` / `logicdefines.inc`: `baby_animal` 48, `adult_animal` 49). Rows
 *  are read at the adult job first, the baby lane as a defensive fallback. The lanes bind the same
 *  sequences except the wolf's action-2 wait (adult `..._wait_clean` vs baby `..._wait_cry`). */
export const ADULT_ANIMAL_JOB = 49;
const BABY_ANIMAL_JOB = 48;
const ANIMAL_JOBS = [ADULT_ANIMAL_JOB, BABY_ANIMAL_JOB] as const;

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
 * sequence is a clean ×8 strip. The wolves/lions author a second, faster `..._running` row;
 * the ordinary gait is the first valid row and the faster row is bound separately.
 */
export function animalWalkSeqName(
  ir: ContentIr | null,
  tribe: number,
  seqByName: ReadonlyMap<string, BobSeqRow>,
): string | undefined {
  const swimming = ANIMAL_EXTRA_ANIMATIONS.get(tribe)?.swimming;
  if (eightDirAnim(seqByName, swimming) !== undefined) return swimming;
  for (const job of ANIMAL_JOBS) {
    for (const row of ir?.gfxWalkAtomics ?? []) {
      if (row.tribe !== tribe || row.job !== job || row.goodType !== ANIMAL_WALK_GOOD_TYPE) continue;
      if (eightDirAnim(seqByName, row.bodySeq) !== undefined) return row.bodySeq;
    }
  }
  return undefined;
}

/** The distinct, faster unloaded gait authored beside the ordinary walk. */
function animalRunSeqName(
  ir: ContentIr | null,
  tribe: number,
  walkName: string | undefined,
  seqByName: ReadonlyMap<string, BobSeqRow>,
): string | undefined {
  if (walkName === undefined) return undefined;
  for (const job of ANIMAL_JOBS) {
    const walks = (ir?.gfxWalkAtomics ?? []).filter(
      (row) => row.tribe === tribe && row.job === job && row.goodType === ANIMAL_WALK_GOOD_TYPE,
    );
    const baseSpeed = walks.find((row) => row.bodySeq === walkName)?.walkSpeed;
    for (const row of walks) {
      if (
        row.bodySeq !== walkName &&
        baseSpeed !== undefined &&
        row.walkSpeed !== undefined &&
        row.walkSpeed < baseSpeed &&
        eightDirAnim(seqByName, row.bodySeq) !== undefined
      )
        return row.bodySeq;
    }
  }
  return undefined;
}

/** Preserve an authored directional walk cut when its facings cannot share one uniform block length. */
function animalWalkAnim(
  seqByName: ReadonlyMap<string, BobSeqRow>,
  name: string | undefined,
  listsBySeq: ReadonlyMap<string, readonly (readonly number[])[]>,
): DirectionalAnim | FrameListAnim | undefined {
  const block = eightDirAnim(seqByName, name, listsBySeq);
  if (block === undefined || name === undefined) return undefined;
  const lists = listsBySeq.get(name);
  const row = seqByName.get(name);
  if (lists === undefined || row === undefined) return block;
  const facingLists = frameListsByFacing(lists);
  if (
    facingLists.length !== block.dirs ||
    facingLists.some(
      (list) =>
        list.length === 0 ||
        list.some((index) => !Number.isInteger(index) || index < 0 || index >= row.length),
    )
  )
    return block;
  const count = block.frames ?? block.stride;
  const uniform = facingLists.every(
    (list, facing) => list.length === count && list.every((index, i) => index === facing * block.stride + i),
  );
  return uniform ? block : { start: row.start, frameLists: facingLists, loop: true };
}

/** An idle action's `[gfxanimatomic]` row and its `[bobseq]` pool start. */
interface IdlePick {
  readonly start: number;
  readonly row: GfxAnimAtomicRow;
}

/**
 * Build one animal tribe's {@link SettlerStateBinding} from the IR lanes. Returns `null` when no idle
 * resolves, so the caller leaves the tribe unbound instead of binding a bogus range.
 *
 * Each idle clip is its row's authored frame-list program: a single-list row plays facing-locked, a
 * per-direction row per facing. Playing the program rather than the raw wait strip matters: a strip packs
 * several poses back-to-back (the bear's sniff, lie, sit) and the program picks one with its authored
 * holds. A resting animal plays `idleChoices`, every idle action's clip to its end in turn. `idle` is the
 * loop an engaged or acting animal falls back to: the first `gfxanimmode 1` row, the authored looping base
 * wait, or else the first one-shot looped (named approximation).
 */
export function animalBinding(
  ir: ContentIr | null,
  tribe: number,
  seqByName: ReadonlyMap<string, BobSeqRow>,
): SettlerStateBinding | null {
  // The mod assigns ducks bull programs with out-of-range indices. Their only own gait is the
  // unbound swim strip; water-only locomotion uses it with a held floating pose at rest.
  const swim = eightDirAnim(seqByName, ANIMAL_EXTRA_ANIMATIONS.get(tribe)?.swimming);
  if (swim !== undefined) return { idle: { ...swim, frames: 1 }, moving: swim };
  const walkLists = gfxWalkFrameLists(ir, tribe);
  const walkName = animalWalkSeqName(ir, tribe, seqByName);
  const walk = animalWalkAnim(seqByName, walkName, walkLists);
  const run = animalWalkAnim(seqByName, animalRunSeqName(ir, tribe, walkName, seqByName), walkLists);

  let first: IdlePick | undefined;
  let loopBase: IdlePick | undefined;
  const waits: IdlePick[] = [];
  for (const action of IDLE_ACTIONS) {
    const row = animalGfxAtomicRow(ir, tribe, action);
    if (row?.bodySeq === undefined) continue;
    const seq = seqByName.get(row.bodySeq);
    if (seq === undefined || seq.length <= 0) continue;
    if (row.dirFrames.every((list) => list.length === 0)) continue; // no program - nothing to play
    const choice = { start: seq.start, row };
    waits.push(choice);
    first ??= choice;
    if (row.mode === GFX_ANIM_MODE_LOOP) loopBase ??= choice;
  }
  const pick = loopBase ?? first;
  let idle: SpriteFrameRef | null =
    pick !== undefined
      ? { start: pick.start, frameLists: frameListsByFacing(pick.row.dirFrames), loop: true }
      : null;
  // No authored wait: hold the walk's first frame per facing (still the right species and heading).
  idle ??=
    walk !== undefined
      ? 'frameLists' in walk
        ? { start: walk.start, frameLists: walk.frameLists.map((list) => list.slice(0, 1)) }
        : { ...walk, frames: 1 }
      : null;
  if (idle === null) return null;
  const idleChoices: FrameListAnim[] = [];
  for (const wait of waits) {
    const frameLists = frameListsByFacing(wait.row.dirFrames);
    idleChoices.push({ start: wait.start, frameLists });
  }

  let attack: FrameListAnim | undefined;
  const fight = animalGfxAtomicRow(ir, tribe, ATTACK_ATOMIC);
  if (fight?.bodySeq !== undefined) {
    const seq = seqByName.get(fight.bodySeq);
    if (seq !== undefined && seq.length > 0 && fight.dirFrames.length > 0) {
      attack = { start: seq.start, frameLists: frameListsByFacing(fight.dirFrames) };
    }
  }

  const extraIdle = animalExtraIdle(tribe, seqByName);
  return {
    idle,
    ...(extraIdle !== undefined ? { idleFidgets: [extraIdle] } : {}),
    ...(idleChoices.length > 0 ? { idleChoices } : {}),
    ...(walk !== undefined ? { moving: walk } : {}),
    ...(run !== undefined ? { running: run } : {}),
    ...(attack !== undefined ? { byAtomic: { [ATTACK_ATOMIC]: attack } } : {}),
  };
}
