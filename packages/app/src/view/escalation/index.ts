import type { MapNotice, MapVariant } from '@open-northland/data';
import type { SimEvent } from '@open-northland/sim';
import type { MissionInfoRow } from '../../game/map/info-lines.js';
import { createCentreNotice } from '../../hud/dom/centre-notice.js';
import { formatMessage, messages } from '../../i18n/index.js';
import type { SessionHost } from '../../session/index.js';
import { createSiegeRows, siegeCountdownLines } from './countdown.js';
import {
  NOTICE_SHOWN_MS,
  NoticeQueue,
  type NoticeShowing,
  noticeText,
  sameNotice,
  siegeNoticesOf,
} from './notices.js';

export interface SiegePresentationDeps {
  readonly host: Pick<SessionHost, 'mapEscalation'>;
  /** The variant the session plays, which names the mode mark and the attack notice; null for none. */
  readonly variant: MapVariant | null;
  readonly plane: HTMLElement;
  /** The map's own strings by id, in the player's map text language; the notices' words. */
  readonly mapText: (stringId: number) => string | undefined;
  /** The world renderer's attack night. */
  readonly setAttackNight: (on: boolean) => void;
  /** The goal slip's mode mark. */
  readonly setModeMark: (text: string | null) => void;
  /** Plays the attack's music once, unless it is still playing. */
  readonly playAttackMusic: () => void;
  readonly now: () => number;
}

/** How a map variant's siege shows: the mode mark on the goal slip, its centre-screen notices, the music and the night of an
 *  attack, and the countdown lines at the head of the goal panel's rows. */
export interface SiegePresentation {
  onEvents(events: readonly SimEvent[]): void;
  /** Once a frame. */
  frame(): void;
  /** The goal panel's `rows` at `tick`, led by the countdown on a map with a siege. */
  infoRows(rows: readonly MissionInfoRow[], tick: number): readonly MissionInfoRow[];
  dispose(): void;
}

export function mountSiegePresentation(deps: SiegePresentationDeps): SiegePresentation {
  const queue = new NoticeQueue<MapNotice>(sameNotice);
  const banner = createCentreNotice(deps.plane, NOTICE_SHOWN_MS);
  const siegeRows = createSiegeRows();
  let night = false;
  let marked = false;
  let showing: NoticeShowing<MapNotice> | null = null;
  return {
    onEvents(events) {
      for (const notice of siegeNoticesOf(events)) queue.push(notice);
      if (events.some((event) => event.kind === 'mapEscalationAttackLaunched')) deps.playAttackMusic();
    },
    frame() {
      if (!marked && deps.variant !== null) {
        marked = true;
        const variant = messages().mainMenu.lobby.variantNames[deps.variant.kind];
        deps.setModeMark(formatMessage(messages().hud.escalation.modeMark, { variant }));
      }
      const running = deps.host.mapEscalation()?.attackRunning === true;
      if (running !== night) {
        night = running;
        deps.setAttackNight(running);
      }
      const next = queue.current(deps.now());
      if (next !== showing) {
        showing = next;
        // A fresh text for every showing, so a notice shown again restarts its fade.
        banner.show(next === null ? null : noticeText(next.notice, deps.mapText));
      }
    },
    infoRows(rows, tick) {
      const lines = siegeCountdownLines(deps.host.mapEscalation(), tick, messages().hud.escalation);
      return siegeRows(rows, lines);
    },
    dispose() {
      banner.dispose();
      deps.setAttackNight(false);
    },
  };
}
