import type { AtomicAnimation, ContentSet } from '@open-northland/data';
import { systems } from '@open-northland/sim';

/** The drill clip of the first soldier any tribe binds one for, undefined when the content binds none.
 *  Every tribe's clip is alike in the shipped content. */
function firstCoinDrillClip(content: ContentSet): AtomicAnimation | undefined {
  for (const job of content.jobs) {
    if (!systems.isSoldierJob(content, job.typeId)) continue;
    for (const tribe of content.tribes) {
      const clip = systems.coinDrillClip(content, { tribe: tribe.typeId, jobType: job.typeId });
      if (clip !== undefined && systems.coinDrillPointsOf(clip) > 0) return clip;
    }
  }
  return undefined;
}

/** The fight points one coin of a coin drill buys, 0 when the content binds no drill clip. */
export function coinDrillPointsOf(content: ContentSet): number {
  const clip = firstCoinDrillClip(content);
  return clip === undefined ? 0 : systems.coinDrillPointsOf(clip);
}

/** The coins one term of a coin drill takes, 0 when the content binds no drill clip. */
export function coinDrillCoinsOf(content: ContentSet): number {
  const clip = firstCoinDrillClip(content);
  return clip === undefined ? 0 : systems.coinDrillCoinsOf(clip);
}

/** The ticks one coin's term keeps a soldier inside: whole repetitions of the drill clip until the term
 *  is drawn down, so the last one overruns it. Undefined when the content binds no drill clip. */
export function coinDrillServedTicksOf(content: ContentSet): number | undefined {
  const clip = firstCoinDrillClip(content);
  if (clip === undefined) return undefined;
  const repetition = Math.max(1, clip.length);
  return Math.ceil(systems.COIN_DRILL_TERM_TICKS / repetition) * repetition;
}
