import type { OneShot } from './types.js';

/**
 * Running one-shot counts for a probe or an acceptance scene: how many shots each lane was offered and
 * started, and how many world shots lost their slot to a louder one. Totals since the driver was built;
 * a reader differences two reads for a frame's counts, so counting allocates nothing.
 */

/** The arbiter's lanes, and `free` for a shot in none (a GUI cue, an order's answer). */
export type StatLane = 'jingle' | 'alert' | 'voice' | 'sfx' | 'ambience' | 'free';

export const STAT_LANES: readonly StatLane[] = ['jingle', 'alert', 'voice', 'sfx', 'ambience', 'free'];

export type LaneCounts = Record<StatLane, number>;

export interface SoundStats {
  /** Frames the driver decided while audible. */
  frames: number;
  /** Shots handed to the arbiter, by lane. */
  readonly offered: LaneCounts;
  /** Shots the arbiter let the engine start, by lane. A jingle waiting for its lane counts when it
   *  rings, so `offered - started` over a short span can include jingles still waiting. */
  readonly started: LaneCounts;
  /** World shots faded out because a louder one took their slot. */
  stolen: number;
}

/** A read-only view of {@link SoundStats}. */
export type SoundStatsView = {
  readonly frames: number;
  readonly offered: Readonly<LaneCounts>;
  readonly started: Readonly<LaneCounts>;
  readonly stolen: number;
};

export function zeroLanes(): LaneCounts {
  return { jingle: 0, alert: 0, voice: 0, sfx: 0, ambience: 0, free: 0 };
}

export function emptySoundStats(): SoundStats {
  return { frames: 0, offered: zeroLanes(), started: zeroLanes(), stolen: 0 };
}

/** A detached copy of `stats`, for a read a later one is compared against or one sent off the page. */
export function copySoundStats(stats: SoundStatsView): SoundStatsView {
  return { ...stats, offered: { ...stats.offered }, started: { ...stats.started } };
}

export function statLane(shot: OneShot): StatLane {
  return shot.lane?.kind ?? 'free';
}

/** Add each of `shots` to its lane's count in `into`. */
export function countShots(into: LaneCounts, shots: readonly OneShot[]): void {
  for (const shot of shots) into[statLane(shot)]++;
}
