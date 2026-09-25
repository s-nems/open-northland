import type { PlayerCommand, Simulation } from '@open-northland/sim';
import type { AssistantCounterId } from '../hud/tool-panel/extras-menu.js';
import { type AssistantCounterFace, SIM_KIND_BY_COUNTER_ID } from '../hud/tool-panel/extras-menu.js';
import type { ExtrasCountersSeam } from '../hud/tool-panel/extras-window.js';

const COUNTER_OFF: AssistantCounterFace = { value: 0, infinite: false };

/**
 * Live chest-window counter seam for the seat `player` names, read on every call so a spectator's
 * window follows its watched seat; no seat (null, the whole map) reads every counter as zero. A
 * read-only spectator session (`writable: false`) rejects every write, so the window never echoes a
 * command the sim would drop.
 */
export function assistantCountersSeam(
  sim: Pick<Simulation, 'assistantCounters'>,
  player: () => number | null,
  enqueue: (command: PlayerCommand) => void,
  writable = true,
): ExtrasCountersSeam {
  return {
    read: () => {
      const seat = player();
      const live = seat === null ? null : sim.assistantCounters(seat);
      const face = (id: AssistantCounterId): AssistantCounterFace => {
        if (live === null) return COUNTER_OFF;
        const kind = live[SIM_KIND_BY_COUNTER_ID[id]];
        return { value: kind.value, infinite: kind.infinite };
      };
      return {
        extraWomen: face('extraWomen'),
        extraMen: face('extraMen'),
        trainSoldiers: face('trainSoldiers'),
        trainSwordsmen: face('trainSwordsmen'),
        trainSpearmen: face('trainSpearmen'),
        trainArchers: face('trainArchers'),
      };
    },
    set: (id, value, infinite) => {
      const seat = player();
      if (!writable || seat === null) return false;
      enqueue({
        kind: 'setAssistantCounter',
        player: seat,
        counter: SIM_KIND_BY_COUNTER_ID[id],
        value,
        infinite,
      });
      return true;
    },
  };
}
