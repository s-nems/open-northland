import { JOB_CARRIER, JOB_COLLECTOR, JOB_SCOUT } from '../../../catalog/jobs.js';
import { PROFESSIONS } from '../../../catalog/professions.js';
import { GOOD_GOLD, GOOD_IRON } from '../../../game/sandbox/ids/economy/goods.js';
import { formatMessage, messages, professionLabel } from '../../../i18n/index.js';
import type { TradePick } from './rows.js';

/** The trades anyone may take, which a search for who could take them would list whole. */
const OPEN_TRADES: ReadonlySet<number> = new Set([JOB_COLLECTOR, JOB_CARRIER, JOB_SCOUT]);

/** The gathered goods the tribes gate behind experience (`needforgood`), each a collector pick. */
const GATED_GATHER_GOODS = [
  { goodType: GOOD_IRON, key: 'iron' },
  { goodType: GOOD_GOLD, key: 'gold' },
] as const;

export interface CanBecomeOption {
  readonly pick: TradePick;
  readonly label: string;
}

/** What the residents window's "can become" filter offers, in picker order: every trade but the open
 *  ones, and a collector of each gated good where the plain collector would stand. */
export function canBecomeOptions(): CanBecomeOption[] {
  const goods = messages().goods;
  return PROFESSIONS.flatMap((profession): CanBecomeOption[] => {
    if (profession.jobType === JOB_COLLECTOR) {
      return GATED_GATHER_GOODS.map(({ goodType, key }) => ({
        pick: { jobType: JOB_COLLECTOR, goodType },
        label: formatMessage(messages().hud.residentsWindow.collectorOf, { good: goods[key] }),
      }));
    }
    if (OPEN_TRADES.has(profession.jobType)) return [];
    return [
      { pick: { jobType: profession.jobType, goodType: null }, label: professionLabel(profession.key) },
    ];
  });
}
