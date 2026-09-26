import { diag } from '../../diag/log.js';
import type { TickBatch } from './protocol.js';

/** Ticks the worker shed since the last batch that shed none. */
interface ShedEpisode {
  readonly ticks: number;
  readonly firstTick: number;
  readonly lastTick: number;
}

/** Tallies the ticks a shedding worker dropped, and logs each episode once a batch arrives with none
 *  shed. */
export class ShedLog {
  private episode: ShedEpisode | null = null;

  note(batch: TickBatch): void {
    const episode = this.episode;
    if (batch.shedTicks === 0) {
      if (episode === null) return;
      this.episode = null;
      diag.warn(
        'sim',
        `the runtime fell behind the sim worker: the events of ${episode.ticks} ticks between ticks ` +
          `${episode.firstTick} and ${episode.lastTick} were dropped`,
        episode,
      );
      return;
    }
    // The shed ticks directly precede the batch's first record.
    const firstRecordTick = batch.ticks[0]?.tick ?? batch.delta.tick;
    const firstTick = firstRecordTick - batch.shedTicks;
    const lastTick = firstRecordTick - 1;
    this.episode =
      episode === null
        ? { ticks: batch.shedTicks, firstTick, lastTick }
        : { ticks: episode.ticks + batch.shedTicks, firstTick: episode.firstTick, lastTick };
  }
}
