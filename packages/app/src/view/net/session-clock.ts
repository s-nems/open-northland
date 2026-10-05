import type { ClockState } from '@open-northland/net-client';
import type { NetClockModel } from '../../hud/network/model.js';
import { type GameSpeedControl, presetAtOrBelow } from '../../hud/tool-panel/game-speed.js';
import { formatMessage, messages } from '../../i18n/index.js';

/** The control at the room's requested speed, so the speed key and the segments step from the request
 *  and never re-send it. A governed room's running speed shows through the bar's look instead
 *  (`speedBarLook`), as a held room's pause does. */
export function speedControlFor(clock: Pick<NetClockModel, 'requestedSpeed' | 'paused'>): GameSpeedControl {
  return { running: presetAtOrBelow(clock.requestedSpeed), paused: clock.paused };
}

/** The line the chat announces a clock change with, or null when nobody made it or nothing changed. */
export function clockAnnouncement(previous: ClockState | null, next: ClockState): string | null {
  const nick = next.by;
  if (nick === null) return null;
  const copy = messages().net;
  if (previous === null || previous.paused !== next.paused) {
    return formatMessage(next.paused ? copy.paused : copy.resumed, { nick });
  }
  if (previous.speed !== next.speed) return formatMessage(copy.speed, { nick, speed: next.speed });
  return null;
}
