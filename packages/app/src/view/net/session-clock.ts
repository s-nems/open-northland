import type { ClockState } from '@open-northland/net-client';
import type { GameSpeedControl, RunningGameSpeed } from '../../hud/tool-panel/game-speed.js';
import { formatMessage, messages } from '../../i18n/index.js';

/** The speed button's running states by the multiplier they stand for. */
const RUNNING_BY_MULTIPLIER: ReadonlyMap<number, RunningGameSpeed> = new Map([
  [1, 'normal'],
  [2, 'fast'],
  [3, 'faster'],
]);

/** The speed button state for the relay's clock; a multiplier the button cannot show keeps the current one. */
export function speedControlFor(clock: ClockState, current: GameSpeedControl): GameSpeedControl {
  return { running: RUNNING_BY_MULTIPLIER.get(clock.speed) ?? current.running, paused: clock.paused };
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
