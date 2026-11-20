import { type GfxInHouseProgram, type GfxInHouseWalk, UNLOADED_GOOD_TYPE } from '@open-northland/data';
import { GFX_DIR_TO_FACING } from '../sprites/settler.js';
import type { SpriteState } from './draw-item.js';
import { facingFromScreenHeading } from './snapshot-readers/facing.js';

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

/** A `[GfxLandscape]` effect a program stages at one moment: the record's `EditName` and where it
 *  draws, as an offset from the house's own screen anchor (world px). */
export interface InHouseOverlay {
  readonly name: string;
  readonly dx: number;
  readonly dy: number;
}

/** A program's windows are percentages of the atomic's length. */
const PERCENT = 100;

/** How far through a `duration`-tick performance `elapsed` ticks reach, on the windows' percent scale; a
 *  zero-length performance reads as its opening moment. */
function programPercent(elapsed: number, duration: number): number {
  return duration > 0 ? (Math.min(elapsed, duration) / duration) * PERCENT : 0;
}

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
  const pct = programPercent(elapsed, duration);
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

/**
 * The landscape effects `program` has open `elapsed` ticks into a `duration`-tick performance (the fire
 * under the druid's cauldron, the smoke over it, the kiln's and the forge's flame), in file order. The
 * `houseBob` overlays, which redraw one of the house's own bob layers, are not staged yet.
 */
export function inHouseOverlays(
  program: GfxInHouseProgram,
  elapsed: number,
  duration: number,
): InHouseOverlay[] {
  const pct = programPercent(elapsed, duration);
  const open: InHouseOverlay[] = [];
  for (const entry of program.entries) {
    if (entry.kind !== 'landscape' || !contains(entry, pct)) continue;
    open.push({ name: entry.name, dx: entry.x, dy: entry.y });
  }
  return open;
}

/** A point in a program's frame: pixels from the house's own screen anchor. */
export interface HousePoint {
  readonly x: number;
  readonly y: number;
}

/** The movement-direction `<dir>` heading from `from` to `to`, or `fallback` where they meet. */
function dirToward(from: HousePoint, to: HousePoint, fallback: number): number {
  if (from.x === to.x && from.y === to.y) return fallback;
  const facings: readonly number[] = GFX_DIR_TO_FACING;
  const dir = facings.indexOf(facingFromScreenHeading(to.x - from.x, to.y - from.y));
  return dir >= 0 ? dir : fallback;
}

/**
 * `program` played by a settler standing outside the house at `origin`: it steps straight from there to
 * where the first clip plays and, after the last clip, straight back, in place of the walks the program
 * routes through the doorway. The well's drawer, already at the crank side, so only turns to the crank.
 */
export function fromStand(program: GfxInHouseProgram, origin: HousePoint): GfxInHouseProgram {
  const entries = program.entries;
  const first = entries.findIndex((entry) => entry.kind === 'clip');
  let last = first;
  entries.forEach((entry, i) => {
    if (entry.kind === 'clip') last = i;
  });
  const firstClip = entries[first];
  const lastClip = entries[last];
  if (firstClip?.kind !== 'clip' || lastClip?.kind !== 'clip') return program;
  const before = entries.slice(0, first).filter((entry) => entry.kind === 'walk');
  const after = entries.slice(last + 1).filter((entry) => entry.kind === 'walk');
  const approach = before.at(-1);
  const spot: HousePoint = approach ?? origin;
  const approachGood = approach?.goodType ?? UNLOADED_GOOD_TYPE;
  const toSpot = dirToward(origin, spot, approach?.dir ?? firstClip.dir);
  const toOrigin = dirToward(spot, origin, after[0]?.dir ?? lastClip.dir);
  const back = { goodType: after.at(-1)?.goodType ?? approachGood, ...origin };
  return {
    ...program,
    entries: [
      { kind: 'walk', dir: toSpot, goodType: approachGood, ...origin, from: 0, to: 0 },
      {
        kind: 'walk',
        dir: toSpot,
        goodType: approachGood,
        x: spot.x,
        y: spot.y,
        from: 0,
        to: firstClip.from,
      },
      ...entries.slice(first, last + 1),
      { kind: 'walk', dir: toOrigin, ...back, from: lastClip.to, to: PERCENT },
      ...entries.filter((entry, i) => entry.kind === 'landscape' && (i < first || i > last)),
    ],
  };
}
