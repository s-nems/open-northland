import type { Command, Simulation } from '@open-northland/sim';
import type { AssistantGrantId } from '../hud/tool-panel/extras-menu.js';
import type { ExtrasGrantsSeam } from '../hud/tool-panel/extras-window.js';

/**
 * Which goods each chest-window grant switch flips, by catalog SLUG - resolved against the live
 * content at mount, never by type id: the sandbox catalog and real content number the same goods
 * differently (sandbox 130-155 vs the original ids), while the slug is the shared key the equip
 * overlay itself joins on (`real-content.ts` `EQUIP_CLASS_BY_SLUG`).
 */
const GRANT_GOOD_SLUGS: Readonly<Record<AssistantGrantId, readonly string[]>> = {
  giveBoots: ['shoes'],
  giveWoodenTools: ['tool_wooden'],
  giveIronTools: ['tool_iron'],
  giveMead: ['mead'],
};

const GRANT_IDS = Object.keys(GRANT_GOOD_SLUGS) as readonly AssistantGrantId[];

/** The slice of a content set the grant join needs (structural, so tests stay tiny). */
interface GrantContent {
  readonly goods: ReadonlyArray<{ readonly typeId: number; readonly id: string }>;
}

/** Resolve each switch's slugs to the content's good type ids (a slug the content lacks resolves
 *  to nothing - that switch then reads OFF and writes nothing). */
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

/** The chest window's live grant seam for `player`: reads the sim's grant list, writes one
 *  `setAssistantGrant` per mapped good through the session's command seam. `writable: false` (a
 *  read-only spectator session) rejects every write, so the window never echoes a dropped command. */
export function assistantGrantsSeam(
  sim: Pick<Simulation, 'assistantGrants'>,
  content: GrantContent,
  player: number,
  enqueue: (command: Command) => void,
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

/** Switch every grant ON for `player` at world start - all four chest-window switches default to
 *  enabled in a playable map (user decision 2026-07-24); scenes stay neutral fixtures and start with
 *  the sim default (nothing granted), like the needs toggle. */
export function grantAssistantDefaults(
  sim: Pick<Simulation, 'enqueue'>,
  content: GrantContent,
  player: number,
): void {
  const grantGoods = resolveGrantGoods(content);
  for (const id of GRANT_IDS) {
    for (const goodType of grantGoods[id]) {
      sim.enqueue({ kind: 'setAssistantGrant', player, goodType, enabled: true });
    }
  }
}
