import type { PlayerCommand, Simulation } from '@open-northland/sim';
import { type AssistantGrantId, GRANT_IDS } from '../hud/tool-panel/extras-menu.js';
import type { ExtrasGrantsSeam } from '../hud/tool-panel/extras-window.js';

/**
 * Which goods each chest-window grant switch flips, keyed by catalog slug because the sandbox
 * catalog and real content number the same goods differently.
 */
const GRANT_GOOD_SLUGS: Readonly<Record<AssistantGrantId, readonly string[]>> = {
  giveBoots: ['shoes'],
  giveWoodenTools: ['tool_wooden'],
  giveIronTools: ['tool_iron'],
  giveMead: ['mead'],
};

interface GrantContent {
  readonly goods: ReadonlyArray<{ readonly typeId: number; readonly id: string }>;
}

/** A slug the content lacks resolves to nothing, so that switch reads OFF and writes nothing. */
function resolveGrantGoods(content: GrantContent): Record<AssistantGrantId, readonly number[]> {
  const byId = new Map(content.goods.map((g) => [g.id, g.typeId]));
  const resolve = (id: AssistantGrantId): readonly number[] =>
    GRANT_GOOD_SLUGS[id].flatMap((slug) => {
      const typeId = byId.get(slug);
      return typeId === undefined ? [] : [typeId];
    });
  return Object.fromEntries(GRANT_IDS.map((id) => [id, resolve(id)])) as Record<
    AssistantGrantId,
    readonly number[]
  >;
}

/** Live chest-window grant seam for `player`. A read-only spectator session (`writable: false`)
 *  rejects every write, so the window never echoes a command the sim would drop. */
export function assistantGrantsSeam(
  sim: Pick<Simulation, 'assistantGrants'>,
  content: GrantContent,
  player: number,
  enqueue: (command: PlayerCommand) => void,
  writable = true,
): ExtrasGrantsSeam {
  const grantGoods = resolveGrantGoods(content);
  return {
    read: () => {
      const granted = new Set(sim.assistantGrants(player));
      const on = (id: AssistantGrantId): boolean => {
        const goods = grantGoods[id];
        return goods.length > 0 && goods.every((g) => granted.has(g));
      };
      return Object.fromEntries(GRANT_IDS.map((id) => [id, on(id)])) as Record<AssistantGrantId, boolean>;
    },
    set: (id, enabled) => {
      const goods = grantGoods[id];
      if (!writable || goods.length === 0) return false;
      for (const goodType of goods) {
        enqueue({ kind: 'setAssistantGrant', player, goodType, enabled });
      }
      return true;
    },
  };
}

/** Grants start enabled in a playable map only; scenes keep the sim default of nothing granted. */
export function grantAssistantDefaults(
  sim: Pick<Simulation, 'enqueueSetup'>,
  content: GrantContent,
  players: readonly number[],
): void {
  const grantGoods = resolveGrantGoods(content);
  for (const player of new Set(players)) {
    for (const id of GRANT_IDS) {
      for (const goodType of grantGoods[id]) {
        sim.enqueueSetup({ kind: 'setAssistantGrant', player, goodType, enabled: true });
      }
    }
  }
}
