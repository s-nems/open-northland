import { type AssistantGrantGroup, components, type PlayerCommand } from '@open-northland/sim';
import {
  type AssistantGrantId,
  GIVE_SWITCH_GOODS,
  GIVE_SWITCH_IDS,
  type GiveSwitchId,
  GRANT_IDS,
} from '../../game/assistant-grant-ids.js';
import type { WorldSetup } from '../../game/world/index.js';
import type { AssistantSwitchesSeam } from '../../hud/dom/assistant-window/index.js';
import type { SessionHost } from '../../session/index.js';

/** The switches that map to no good: each flips one sim assistant switch. */
type SimSwitchId = Exclude<AssistantGrantId, GiveSwitchId>;
const SIM_SWITCH_COMMANDS: Readonly<
  Record<
    SimSwitchId,
    | 'setAssistantUpgradeTools'
    | 'setAssistantPostGraduates'
    | 'setAssistantMoveFlags'
    | 'setAssistantFoundFamilies'
  >
> = {
  upgradeTools: 'setAssistantUpgradeTools',
  postGraduates: 'setAssistantPostGraduates',
  moveFlags: 'setAssistantMoveFlags',
  foundFamilies: 'setAssistantFoundFamilies',
};
const isSimSwitch = (id: AssistantGrantId): id is SimSwitchId => id in SIM_SWITCH_COMMANDS;

interface GrantContent {
  readonly goods: ReadonlyArray<{ readonly typeId: number; readonly id: string }>;
}

/** A give switch's goods the content has, in switch order; a switch with none reads OFF and writes nothing. */
function resolveGrantGoods(content: GrantContent): ReadonlyMap<GiveSwitchId, readonly number[]> {
  const byId = new Map(content.goods.map((g) => [g.id, g.typeId]));
  const give = new Map<GiveSwitchId, readonly number[]>();
  for (const id of GIVE_SWITCH_IDS) {
    const goods = GIVE_SWITCH_GOODS[id].flatMap((slug) => {
      const typeId = byId.get(slug);
      return typeId === undefined ? [] : [typeId];
    });
    if (goods.length > 0) give.set(id, goods);
  }
  return give;
}

/** Live assistant switch seam for the seat `player` names, read on every call so a spectator's
 *  window follows its watched seat; no seat (null, the whole map) reads every switch OFF. A read-only
 *  spectator session (`writable: false`) rejects every write, so the window never echoes a command
 *  the sim would drop. A give switch reads ON while every good it grants is granted, and a group as
 *  receiving it while none of those goods is withheld from that group. */
export function assistantGrantsSeam(
  host: Pick<
    SessionHost,
    | 'assistantGrants'
    | 'assistantWithheldGrants'
    | 'assistantUpgradesTools'
    | 'assistantPostsGraduates'
    | 'assistantMovesFlags'
    | 'assistantFoundsFamilies'
  >,
  content: GrantContent,
  player: () => number | null,
  enqueue: (command: PlayerCommand) => void,
  writable = true,
): AssistantSwitchesSeam {
  const grantGoods = resolveGrantGoods(content);
  return {
    read: () => {
      const seat = player();
      const granted = new Set(seat === null ? [] : host.assistantGrants(seat));
      const on = (id: AssistantGrantId): boolean => {
        if (seat === null) return false;
        if (id === 'upgradeTools') return host.assistantUpgradesTools(seat);
        if (id === 'postGraduates') return host.assistantPostsGraduates(seat);
        if (id === 'moveFlags') return host.assistantMovesFlags(seat);
        if (id === 'foundFamilies') return host.assistantFoundsFamilies(seat);
        const goods = grantGoods.get(id);
        return goods !== undefined && goods.every((goodType) => granted.has(goodType));
      };
      return Object.fromEntries(GRANT_IDS.map((id) => [id, on(id)])) as Record<AssistantGrantId, boolean>;
    },
    set: (id, enabled) => {
      const seat = player();
      if (!writable || seat === null) return false;
      if (isSimSwitch(id)) {
        enqueue({ kind: SIM_SWITCH_COMMANDS[id], player: seat, enabled });
        return true;
      }
      const goods = grantGoods.get(id);
      if (goods === undefined) return false;
      for (const goodType of goods) enqueue({ kind: 'setAssistantGrant', player: seat, goodType, enabled });
      return true;
    },
    readAudiences: () => {
      const seat = player();
      const withheld = seat === null ? null : host.assistantWithheldGrants(seat);
      const audienceOf = (id: GiveSwitchId): readonly AssistantGrantGroup[] => {
        const goods = grantGoods.get(id) ?? [];
        return components.ASSISTANT_GRANT_GROUPS.filter(
          (group) => !goods.some((goodType) => withheld?.[group].includes(goodType) === true),
        );
      };
      return Object.fromEntries(GIVE_SWITCH_IDS.map((id) => [id, audienceOf(id)])) as Record<
        GiveSwitchId,
        readonly AssistantGrantGroup[]
      >;
    },
    setAudience: (id, groups) => {
      const seat = player();
      if (!writable || seat === null) return false;
      const goods = grantGoods.get(id);
      if (goods === undefined) return false;
      for (const goodType of goods) {
        enqueue({ kind: 'setAssistantGrantAudience', player: seat, goodType, groups: [...groups] });
      }
      return true;
    },
  };
}

/** A playable map's one departure from the sim's all-off assistant: the tool upgrade starts on, where it
 *  waits for the iron tools switch. Scenes keep the sim default throughout. */
export function startAssistantSwitches(sim: WorldSetup, players: readonly number[]): void {
  for (const player of new Set(players)) {
    sim.enqueueSetup({ kind: 'setAssistantUpgradeTools', player, enabled: true });
  }
}
