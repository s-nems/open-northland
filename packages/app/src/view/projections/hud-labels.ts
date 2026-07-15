import type { HudLabels } from '@open-northland/render';
import { formatMessage, messages } from '../../i18n/index.js';

/** Bridge the app locale catalog into render's pure HUD layout. */
export function hudLabels(): HudLabels {
  const copy = messages().hud.stats;
  return {
    tribeTick: (tribe, tick) => formatMessage(copy.tribeTick, { tribe, tick }),
    population: (population) => formatMessage(copy.population, { population }),
    jobs: copy.jobs,
    stocks: copy.stocks,
    idle: copy.idle,
    job: (jobType) => formatMessage(copy.job, { jobType }),
    good: (goodType) => formatMessage(copy.good, { goodType }),
  };
}
