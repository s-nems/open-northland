import type { ClockState } from '@open-northland/net-client';
import type { NetClockModel } from '../../hud/network/model.js';
import { type GameSpeedControl, presetAtOrBelow } from '../../hud/tool-panel/game-speed.js';
import { formatMessage, messages } from '../../i18n/index.js';

/** The segment the bar presses for the speed the room actually runs at: a room governed to ×2.5
 *  shows ×2, never the ×3 it was asked for. A held room shows its pause through the bar's look. */
export function speedControlFor(clock: Pick<NetClockModel, 'runningSpeed' | 'paused'>): GameSpeedControl {
  return { running: presetAtOrBelow(clock.runningSpeed), paused: clock.paused };
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
