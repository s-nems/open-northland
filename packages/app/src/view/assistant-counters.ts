import { components, type PlayerCommand } from '@open-northland/sim';
import type { AssistantCountersSeam } from '../hud/dom/assistant-window/index.js';
import type { SessionHost } from '../session/index.js';

const NO_COUNTERS = components.defaultAssistantCounters();

/**
 * Live assistant counter seam for the seat `player` names, read on every call so a spectator's window
 * follows its watched seat; no seat (null, the whole map) reads every counter as zero. A read-only
 * spectator session (`writable: false`) rejects every write, so the window never echoes a command the
 * sim would drop.
 */
export function assistantCountersSeam(
  host: Pick<SessionHost, 'assistantCounters'>,
  player: () => number | null,
  enqueue: (command: PlayerCommand) => void,
  writable = true,
): AssistantCountersSeam {
  return {
    read: () => {
      const seat = player();
      return seat === null ? NO_COUNTERS : host.assistantCounters(seat);
    },
    set: (counter, state) => {
      const seat = player();
      if (!writable || seat === null) return false;
      enqueue({ kind: 'setAssistantCounter', player: seat, counter, ...state });
      return true;
    },
  };
}
