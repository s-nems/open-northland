import type { MusicTrack } from './manifest.js';

/**
 * What the music player plays: a sequence of cues it pulls one at a time. Each cue names how many
 * loop passes of its track to play, the silence before it and the fades it opens and parts on.
 */

/** One stretch of music. */
export interface MusicCue {
  readonly track: MusicTrack;
  /** Passes to play: 1 is the first pass alone, each further one repeats the loop region. */
  readonly passes: number;
  /** Seconds of silence between the previous cue falling silent and this one opening. */
  readonly gapBeforeS: number;
  /** Seconds the cue takes to rise from silence as it opens; the player never rises faster than a
   *  click-free ramp, so 0 opens the file as it starts. */
  readonly fadeInS: number;
  /** Seconds the cue takes to fade to silence at its end. */
  readonly fadeS: number;
}

/** A source of cues. `drop` removes a file that could not load, so it is never offered again. */
export interface MusicSequence {
  /** The cue to play next, or null when nothing playable is left. */
  next(): MusicCue | null;
  drop(file: string): void;
}

/** How a fixed rotation's tracks hand over. */
export interface MusicTiming {
  /** Seconds the outgoing track takes to reach silence, ending on the last sample it plays. */
  readonly fadeS: number;
  /** Seconds of silence between the outgoing track and the next. */
  readonly gapS: number;
  /** Seconds the next track takes to rise from silence. */
  readonly fadeInS: number;
}

/** Menu rotation handover: each track opens as its file starts, from the silence its first pass
 *  opens on. The rotation itself is this reimplementation's design, not original behaviour. */
export const MENU_MUSIC_TIMING: MusicTiming = { fadeS: 2, gapS: 1.5, fadeInS: 0 };

/** `tracks` in order, each for its first pass, wrapping at the end. */
export function trackRotation(
  tracks: readonly MusicTrack[],
  timing: MusicTiming = MENU_MUSIC_TIMING,
): MusicSequence {
  let queue = tracks;
  let at = 0;
  return {
    next() {
      const track = queue[at];
      if (track === undefined) return null;
      at = (at + 1) % queue.length;
      return { track, passes: 1, gapBeforeS: timing.gapS, fadeInS: timing.fadeInS, fadeS: timing.fadeS };
    },
    drop(file) {
      const dropped = queue.findIndex((track) => track.file === file);
      if (dropped < 0) return;
      queue = queue.filter((track) => track.file !== file);
      if (dropped < at) at -= 1;
      at = queue.length === 0 ? 0 : at % queue.length;
    },
  };
}

/** The track's loop region inside a decoded buffer of `bufferS`, or null when the file is shorter than
 *  its first pass and can only play through once. */
function loopRegion(track: MusicTrack, bufferS: number): { start: number; end: number } | null {
  const start = track.loopStartS;
  const end = Math.min(track.loopEndS, bufferS);
  return start > 0 && start < end ? { start, end } : null;
}

/** Seconds a cue of `passes` plays: the first pass, then the loop region once per further pass. */
export function cuePlaySeconds(track: MusicTrack, passes: number, bufferS: number): number {
  const region = loopRegion(track, bufferS);
  if (region === null) return bufferS;
  return region.start + (passes - 1) * (region.end - region.start);
}

/** Whether a cue of `passes` has to loop its buffer to play them. */
export function cueLoops(track: MusicTrack, passes: number, bufferS: number): boolean {
  return passes > 1 && loopRegion(track, bufferS) !== null;
}

/**
 * The first pass boundary at or after `at` on the audio clock, for a cue that opened at `startsAt`:
 * where the first pass ends or a loop repeat begins. A file with no loop region has only its end.
 */
export function passBoundaryAfter(track: MusicTrack, bufferS: number, startsAt: number, at: number): number {
  const region = loopRegion(track, bufferS);
  if (region === null) return startsAt + bufferS;
  const firstEnd = startsAt + region.start;
  if (at <= firstEnd) return firstEnd;
  const loopS = region.end - region.start;
  return firstEnd + Math.ceil((at - firstEnd) / loopS) * loopS;
}
