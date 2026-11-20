import type { MapNotice } from '@open-northland/data';
import type { SimEvent } from '@open-northland/sim';
import type { CentreNoticeText } from '../../hud/dom/centre-notice.js';

/** The centre-screen notices a batch of sim events raises, in order. */
export function siegeNoticesOf(events: readonly SimEvent[]): MapNotice[] {
  const out: MapNotice[] = [];
  for (const event of events) {
    switch (event.kind) {
      case 'mapEscalationAttackLaunched':
      case 'mapEscalationGearStep':
      case 'mapEscalationLanding':
        if (event.notice !== undefined) out.push(event.notice);
        break;
      default:
        break;
    }
  }
  return out;
}

export const sameNotice = (a: MapNotice, b: MapNotice): boolean =>
  a.title === b.title && a.detail === b.detail;

/** The notice's words from the map's string table; null when the table lacks its title. A detail the
 *  table lacks is left out. */
export function noticeText(
  notice: MapNotice,
  mapText: (stringId: number) => string | undefined,
): CentreNoticeText | null {
  const title = mapText(notice.title);
  if (title === undefined) return null;
  const detail = notice.detail === undefined ? undefined : mapText(notice.detail);
  return detail === undefined ? { title } : { title, detail };
}

/** How long one notice stands, fade in and out included; foundation.css animates over the same. */
export const NOTICE_SHOWN_MS = 5000;

/** One showing of a notice: a notice shown again is a new showing, so its fade starts over. */
export interface NoticeShowing<T> {
  readonly notice: T;
  readonly sinceMs: number;
}

/** Notices shown one at a time, each for {@link NOTICE_SHOWN_MS}, the rest waiting in order. `same`
 *  tells two notices apart. */
export class NoticeQueue<T> {
  private readonly waiting: T[] = [];
  private shown: NoticeShowing<T> | null = null;

  constructor(private readonly same: (a: T, b: T) => boolean = Object.is) {}

  /** Queue `notice`, unless the same one already waits. */
  push(notice: T): void {
    if (!this.waiting.some((waiting) => this.same(waiting, notice))) this.waiting.push(notice);
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
