import type { MapEscalationNoticeKey } from '@open-northland/data';
import type { SimEvent } from '@open-northland/sim';
import type { Messages } from '../../i18n/en.js';

export type SiegeNoticeId = keyof Messages['hud']['escalation']['notices'];

/** The notice the app shows for each key an escalation may name (`packages/data/src/map-variants`). */
const NOTICE_BY_KEY: Readonly<Record<MapEscalationNoticeKey, SiegeNoticeId>> = {
  'forteca.attack': 'fortecaAttack',
  'forteca.landing': 'fortecaLanding',
  'forteca.reinforcements': 'fortecaReinforcements',
  'forteca.gear.lightArmor': 'fortecaLightArmor',
  'forteca.gear.heavyArmor': 'fortecaHeavyArmor',
  'forteca.gear.amulets': 'fortecaAmulets',
  'forteca.gear.healDraughts': 'fortecaHealDraughts',
};

/** The centre-screen notices a batch of sim events raises, in order. */
export function siegeNoticesOf(events: readonly SimEvent[]): SiegeNoticeId[] {
  const out: SiegeNoticeId[] = [];
  for (const event of events) {
    switch (event.kind) {
      case 'mapEscalationAttackLaunched':
        if (event.noticeKey !== undefined) out.push(NOTICE_BY_KEY[event.noticeKey]);
        break;
      case 'mapEscalationGearStep':
      case 'mapEscalationLanding':
        out.push(NOTICE_BY_KEY[event.noticeKey]);
        break;
      default:
        break;
    }
  }
  return out;
}

/** How long one notice stands, fade in and out included; foundation.css animates over the same. */
export const NOTICE_SHOWN_MS = 5000;

/** One showing of a notice: a notice shown again is a new showing, so its fade starts over. */
export interface NoticeShowing<T> {
  readonly notice: T;
  readonly sinceMs: number;
}

/** Notices shown one at a time, each for {@link NOTICE_SHOWN_MS}, the rest waiting in order. */
export class NoticeQueue<T> {
  private readonly waiting: T[] = [];
  private shown: NoticeShowing<T> | null = null;

  /** Queue `notice`, unless the same one already waits. */
  push(notice: T): void {
    if (!this.waiting.includes(notice)) this.waiting.push(notice);
  }

  /** The showing standing at `nowMs`, null while none waits. */
  current(nowMs: number): NoticeShowing<T> | null {
    if (this.shown !== null && nowMs - this.shown.sinceMs >= NOTICE_SHOWN_MS) this.shown = null;
    if (this.shown === null) {
      const next = this.waiting.shift();
      if (next !== undefined) this.shown = { notice: next, sinceMs: nowMs };
    }
    return this.shown;
  }
}
