import { type GfxInHouseProgram, type GfxInHouseWalk, UNLOADED_GOOD_TYPE } from '@open-northland/data';
import type { SpriteState } from './draw-item.js';

/** The indoor craft choreography by `(tribe, job, action)`, injected by the shell that loaded it, which
 *  keeps the scene a pure function of the snapshot and its content. */
export type InHouseProgramLookup = (
  tribe: number,
  job: number,
  action: number,
) => GfxInHouseProgram | undefined;

/** The sub-clip a program has the worker performing, and how far through it (0..1). */
export interface InHouseClip {
  readonly action: number;
  /** `0` names the job's own record for `action` rather than a `logicinhouseatomicsubid` sub-clip. */
  readonly subId: number;
  readonly progress: number;
}

/** Where a program puts its worker at one moment: a draw offset from the house's own screen anchor
 *  (world px) plus the pose to draw there. */
export interface InHousePose {
  readonly state: SpriteState;
  /** The entry's `<dir>`, still in the source's movement-direction ring. */
  readonly dir: number;
  readonly dx: number;
  readonly dy: number;
  /** The good the worker hauls across the room, {@link UNLOADED_GOOD_TYPE} while empty-handed. */
  readonly goodType: number;
  readonly clip?: InHouseClip;
}

/** A program's windows are percentages of the atomic's length. */
const PERCENT = 100;

/** Where a program that names no walk at all leaves its worker facing. */
const DEFAULT_GFX_DIR = 0;

function contains(entry: { from: number; to: number }, pct: number): boolean {
  return entry.from <= pct && pct < entry.to;
}

/** How far into its own window `pct` sits, 0..1; a zero-length window reads as its start. */
function localProgress(entry: { from: number; to: number }, pct: number): number {
  const span = entry.to - entry.from;
  return span > 0 ? (pct - entry.from) / span : 0;
}

function walkPose(entry: GfxInHouseWalk, from: GfxInHouseWalk | undefined, pct: number): InHousePose {
  const t = localProgress(entry, pct);
  const startX = from?.x ?? entry.x;
  const startY = from?.y ?? entry.y;
  return {
    state: 'moving',
    dir: entry.dir,
    dx: startX + (entry.x - startX) * t,
    dy: startY + (entry.y - startY) * t,
    goodType: entry.goodType,
  };
}

/**
 * The pose `program` puts a worker in `elapsed` ticks into a `duration`-tick performance: the walk it is
 * crossing the room on, or the sub-clip it is playing where the last walk left it. Windows are read in
 * file order and the first containing one wins, matching the source's non-overlapping authoring; a
 * zero-length window only seeds the next walk's starting point. Past the last window the worker stands
 * where its final walk put it, which is the doorway it leaves through.
 */
export function inHousePose(program: GfxInHouseProgram, elapsed: number, duration: number): InHousePose {
  const pct = duration > 0 ? (Math.min(elapsed, duration) / duration) * PERCENT : 0;
  let lastWalk: GfxInHouseWalk | undefined;
  for (const entry of program.entries) {
    if (entry.kind === 'walk') {
      if (contains(entry, pct)) return walkPose(entry, lastWalk, pct);
      if (entry.to <= pct) lastWalk = entry;
      continue;
    }
    if (entry.kind !== 'clip' || !contains(entry, pct)) continue;
    return {
      state: 'acting',
      dir: entry.dir,
      dx: lastWalk?.x ?? 0,
      dy: lastWalk?.y ?? 0,
      goodType: UNLOADED_GOOD_TYPE,
      clip: { action: entry.action, subId: entry.subId, progress: localProgress(entry, pct) },
    };
  }
  return {
    state: 'idle',
    dir: lastWalk?.dir ?? DEFAULT_GFX_DIR,
    dx: lastWalk?.x ?? 0,
    dy: lastWalk?.y ?? 0,
    goodType: lastWalk?.goodType ?? UNLOADED_GOOD_TYPE,
  };
}
