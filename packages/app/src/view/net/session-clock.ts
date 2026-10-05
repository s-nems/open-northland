import type { ClockState } from '@open-northland/net-client';
import type { NetClockModel } from '../../hud/network/model.js';
import {
  GAME_SPEED_STATES,
  type GameSpeedControl,
  type RunningGameSpeed,
} from '../../hud/tool-panel/game-speed.js';
import { formatMessage, messages } from '../../i18n/index.js';

/** The running speed segments by the multiplier each stands for, highest first. */
const PRESETS: readonly { readonly multiplier: number; readonly running: RunningGameSpeed }[] =
  GAME_SPEED_STATES.flatMap((spec) =>
    spec.state === 'paused' ? [] : [{ multiplier: spec.tickMultiplier, running: spec.state }],
  ).sort((a, b) => b.multiplier - a.multiplier);

const SLOWEST_PRESET: RunningGameSpeed = PRESETS.at(-1)?.running ?? 'normal';

/** The segment the bar presses for the speed the room actually runs at: the highest preset not above
 *  it, ×1 below that. A room governed to ×2.5 shows ×2, never the ×3 it was asked for. */
export function speedControlFor(clock: Pick<NetClockModel, 'runningSpeed' | 'paused'>): GameSpeedControl {
  const preset = PRESETS.find((candidate) => candidate.multiplier <= clock.runningSpeed);
  return { running: preset?.running ?? SLOWEST_PRESET, paused: clock.paused };
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
