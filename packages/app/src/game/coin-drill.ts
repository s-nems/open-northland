import type { ContentSet } from '@open-northland/data';
import { systems } from '@open-northland/sim';

/** The fight points one coin of a coin drill buys: what the first soldier clip any tribe binds grants, 0
 *  when the content binds none. Every tribe's clip grants the same in the shipped content. */
export function coinDrillPointsOf(content: ContentSet): number {
  for (const job of content.jobs) {
    if (!systems.isSoldierJob(content, job.typeId)) continue;
    for (const tribe of content.tribes) {
      const points = systems.coinDrillPointsPerCoin(content, { tribe: tribe.typeId, jobType: job.typeId });
      if (points > 0) return points;
    }
  }
  return 0;
}
