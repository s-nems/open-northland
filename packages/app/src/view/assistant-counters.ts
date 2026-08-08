import type { PlayerCommand, Simulation } from '@open-northland/sim';
import type { AssistantCounterId } from '../hud/tool-panel/extras-menu.js';
import { type AssistantCounterFace, SIM_KIND_BY_COUNTER_ID } from '../hud/tool-panel/extras-menu.js';
import type { ExtrasCountersSeam } from '../hud/tool-panel/extras-window.js';

/**
 * Live chest-window counter seam for `player`. A read-only spectator session (`writable: false`)
 * rejects every write, so the window never echoes a command the sim would drop.
 */
export function assistantCountersSeam(
  sim: Pick<Simulation, 'assistantCounters'>,
  player: number,
  enqueue: (command: PlayerCommand) => void,
  writable = true,
): ExtrasCountersSeam {
  return {
    read: () => {
      const live = sim.assistantCounters(player);
      const face = (id: AssistantCounterId): AssistantCounterFace => {
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
      if (!writable) return false;
      enqueue({ kind: 'setAssistantCounter', player, counter: SIM_KIND_BY_COUNTER_ID[id], value, infinite });
      return true;
    },
  };
}
