import type { HudLabels } from '@open-northland/render';
import { formatMessage, messages } from '../../i18n/index.js';

/**
 * Bridge the app locale catalog into render's pure HUD layout. `seatNameOf` supplies a seat's authored
 * name; without one the header falls back to the slot id, which is all an unnamed roster offers.
 */
export function hudLabels(seatNameOf?: (player: number) => string | undefined): HudLabels {
  const copy = messages().hud.stats;
  return {
    playerTick: (player, tick) => {
      const seat = seatNameOf?.(player);
      return seat !== undefined
        ? formatMessage(copy.seatTick, { seat, tick })
        : formatMessage(copy.playerTick, { player, tick });
    },
    population: (population) => formatMessage(copy.population, { population }),
    jobs: copy.jobs,
    stocks: copy.stocks,
    idle: copy.idle,
    job: (jobType) => formatMessage(copy.job, { jobType }),
    good: (goodType) => formatMessage(copy.good, { goodType }),
  };
}
