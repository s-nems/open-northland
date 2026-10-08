import type { PlayerCommand } from '@open-northland/sim';
import {
  type AssistantGrantId,
  AUDIENCE_SWITCH_IDS,
  DEFAULT_GIVE_SWITCHES,
  GIVE_SWITCH_GOODS,
  GIVE_SWITCH_IDS,
  type GiveSwitchId,
  GRANT_IDS,
  WEAPON_SWITCH_GOOD,
  type WeaponSwitchId,
} from '../game/assistant-grant-ids.js';
import type { WorldSetup } from '../game/world/index.js';
import type { AssistantSwitchesSeam } from '../hud/dom/assistant-window/index.js';
import type { SessionHost } from '../session/index.js';

/** The switches that map to no good: each flips one sim assistant switch. */
type SimSwitchId = Exclude<AssistantGrantId, GiveSwitchId | WeaponSwitchId>;
const SIM_SWITCH_COMMANDS: Readonly<
  Record<SimSwitchId, 'setAssistantPostGraduates' | 'setAssistantMoveFlags'>
> = { postGraduates: 'setAssistantPostGraduates', moveFlags: 'setAssistantMoveFlags' };
const isSimSwitch = (id: AssistantGrantId): id is SimSwitchId => id in SIM_SWITCH_COMMANDS;
const isWeaponSwitch = (id: AssistantGrantId): id is WeaponSwitchId => id in WEAPON_SWITCH_GOOD;
const WEAPON_SWITCH_IDS = GRANT_IDS.filter(isWeaponSwitch);

interface GrantContent {
  readonly goods: ReadonlyArray<{ readonly typeId: number; readonly id: string }>;
}

interface GrantGoods {
  /** A give switch's goods the content has, in switch order; a switch with none reads OFF and writes nothing. */
  readonly give: ReadonlyMap<GiveSwitchId, readonly number[]>;
  /** A weapon switch's good; a slug the content lacks leaves the switch out. */
  readonly weapon: ReadonlyMap<WeaponSwitchId, number>;
}

function resolveGrantGoods(content: GrantContent): GrantGoods {
  const byId = new Map(content.goods.map((g) => [g.id, g.typeId]));
  const give = new Map<GiveSwitchId, readonly number[]>();
  for (const id of GIVE_SWITCH_IDS) {
    const goods = GIVE_SWITCH_GOODS[id].flatMap((slug) => {
      const typeId = byId.get(slug);
      return typeId === undefined ? [] : [typeId];
    });
    if (goods.length > 0) give.set(id, goods);
  }
  const weapon = new Map<WeaponSwitchId, number>();
  for (const id of WEAPON_SWITCH_IDS) {
    const typeId = byId.get(WEAPON_SWITCH_GOOD[id]);
    if (typeId !== undefined) weapon.set(id, typeId);
  }
  return { give, weapon };
}

/** Live assistant switch seam for the seat `player` names, read on every call so a spectator's
 *  window follows its watched seat; no seat (null, the whole map) reads every switch OFF. A read-only
 *  spectator session (`writable: false`) rejects every write, so the window never echoes a command
 *  the sim would drop. A give switch reads ON while every good it grants is granted, and soldiers-only
 *  while every good it grants is limited. */
export function assistantGrantsSeam(
  host: Pick<
    SessionHost,
    | 'assistantGrants'
    | 'assistantWeaponVetoes'
    | 'assistantSoldierOnlyGrants'
    | 'assistantPostsGraduates'
    | 'assistantMovesFlags'
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
      const vetoed = new Set(seat === null ? [] : host.assistantWeaponVetoes(seat));
      const on = (id: AssistantGrantId): boolean => {
        if (seat === null) return false;
        if (id === 'postGraduates') return host.assistantPostsGraduates(seat);
        if (id === 'moveFlags') return host.assistantMovesFlags(seat);
        if (isWeaponSwitch(id)) {
          const goodType = grantGoods.weapon.get(id);
          return goodType !== undefined && !vetoed.has(goodType);
        }
        const goods = grantGoods.give.get(id);
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
      if (isWeaponSwitch(id)) {
        const goodType = grantGoods.weapon.get(id);
        if (goodType === undefined) return false;
        enqueue({ kind: 'setAssistantWeaponVeto', player: seat, goodType, vetoed: !enabled });
        return true;
      }
      const goods = grantGoods.give.get(id);
      if (goods === undefined) return false;
      for (const goodType of goods) enqueue({ kind: 'setAssistantGrant', player: seat, goodType, enabled });
      return true;
    },
    readSoldiersOnly: () => {
      const seat = player();
      const limited = new Set(seat === null ? [] : host.assistantSoldierOnlyGrants(seat));
      const entries = AUDIENCE_SWITCH_IDS.map((id) => {
        const goods = grantGoods.give.get(id);
        return [id, goods !== undefined && goods.every((goodType) => limited.has(goodType))];
      });
      return Object.fromEntries(entries) as Record<GiveSwitchId, boolean>;
    },
    setSoldiersOnly: (id, soldiersOnly) => {
      const seat = player();
      if (!writable || seat === null) return false;
      const goods = grantGoods.give.get(id);
      if (goods === undefined) return false;
      for (const goodType of goods) {
        enqueue({ kind: 'setAssistantGrantAudience', player: seat, goodType, soldiersOnly });
      }
      return true;
    },
  };
}

/** The default give switches start enabled in a playable map only; scenes keep the sim default of nothing
 *  granted. Every weapon starts allowed and every good open to everyone: the sim defaults, no command
 *  needed. */
export function grantAssistantDefaults(
  sim: WorldSetup,
  content: GrantContent,
  players: readonly number[],
): void {
  const grantGoods = resolveGrantGoods(content);
  for (const player of new Set(players)) {
    for (const id of DEFAULT_GIVE_SWITCHES) {
      for (const goodType of grantGoods.give.get(id) ?? []) {
        sim.enqueueSetup({ kind: 'setAssistantGrant', player, goodType, enabled: true });
      }
    }
  }
}
