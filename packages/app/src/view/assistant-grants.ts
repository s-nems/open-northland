import type { PlayerCommand } from '@open-northland/sim';
import { type AssistantGrantId, GRANT_IDS } from '../game/assistant-grant-ids.js';
import type { WorldSetup } from '../game/world/index.js';
import type { ExtrasGrantsSeam } from '../hud/tool-panel/extras-window.js';
import type { SessionHost } from '../session/index.js';

type WeaponSwitchId = Extract<AssistantGrantId, `allow${string}`>;
type GiveSwitchId = Extract<AssistantGrantId, `give${string}`>;
type GoodSwitchId = GiveSwitchId | WeaponSwitchId;
/** The switches that map to no good: each flips one sim assistant switch. */
type SimSwitchId = Exclude<AssistantGrantId, GoodSwitchId>;
const SIM_SWITCH_COMMANDS: Readonly<
  Record<SimSwitchId, 'setAssistantPostGraduates' | 'setAssistantMoveFlags'>
> = { postGraduates: 'setAssistantPostGraduates', moveFlags: 'setAssistantMoveFlags' };
const isSimSwitch = (id: AssistantGrantId): id is SimSwitchId => id in SIM_SWITCH_COMMANDS;
const GOOD_SWITCH_IDS = GRANT_IDS.filter((id): id is GoodSwitchId => !isSimSwitch(id));

/**
 * Which goods each chest-window switch flips, keyed by catalog slug because the sandbox catalog and real
 * content number the same goods differently. A grant switch grants its goods, a weapon switch lifts their
 * recruit-arming veto.
 */
const GRANT_GOOD_SLUGS: Readonly<Record<GiveSwitchId, readonly string[]>> = {
  giveBoots: ['shoes'],
  giveWoodenTools: ['tool_wooden'],
  giveIronTools: ['tool_iron'],
  giveMead: ['mead'],
};
const WEAPON_GOOD_SLUGS: Readonly<Record<WeaponSwitchId, readonly string[]>> = {
  allowShortSwords: ['sword_shord'],
  allowWoodenSpears: ['spear_wooden'],
  allowShortBows: ['bow_short'],
};
const SWITCH_GOOD_SLUGS: Readonly<Record<GoodSwitchId, readonly string[]>> = {
  ...GRANT_GOOD_SLUGS,
  ...WEAPON_GOOD_SLUGS,
};

function isWeaponSwitch(id: GoodSwitchId): id is WeaponSwitchId {
  return id in WEAPON_GOOD_SLUGS;
}

interface GrantContent {
  readonly goods: ReadonlyArray<{ readonly typeId: number; readonly id: string }>;
}

/** A slug the content lacks resolves to nothing, so that switch reads OFF and writes nothing. */
function resolveGrantGoods(content: GrantContent): Record<GoodSwitchId, readonly number[]> {
  const byId = new Map(content.goods.map((g) => [g.id, g.typeId]));
  const resolve = (id: GoodSwitchId): readonly number[] =>
    SWITCH_GOOD_SLUGS[id].flatMap((slug) => {
      const typeId = byId.get(slug);
      return typeId === undefined ? [] : [typeId];
    });
  return Object.fromEntries(GOOD_SWITCH_IDS.map((id) => [id, resolve(id)])) as Record<
    GoodSwitchId,
    readonly number[]
  >;
}

/** Live chest-window switch seam for the seat `player` names, read on every call so a spectator's
 *  window follows its watched seat; no seat (null, the whole map) reads every switch OFF. A read-only
 *  spectator session (`writable: false`) rejects every write, so the window never echoes a command
 *  the sim would drop. */
export function assistantGrantsSeam(
  host: Pick<
    SessionHost,
    'assistantGrants' | 'assistantWeaponVetoes' | 'assistantPostsGraduates' | 'assistantMovesFlags'
  >,
  content: GrantContent,
  player: () => number | null,
  enqueue: (command: PlayerCommand) => void,
  writable = true,
): ExtrasGrantsSeam {
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
        const goods = grantGoods[id];
        if (goods.length === 0) return false;
        return isWeaponSwitch(id) ? goods.every((g) => !vetoed.has(g)) : goods.every((g) => granted.has(g));
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
      const goods = grantGoods[id];
      if (goods.length === 0) return false;
      for (const goodType of goods) {
        enqueue(
          isWeaponSwitch(id)
            ? { kind: 'setAssistantWeaponVeto', player: seat, goodType, vetoed: !enabled }
            : { kind: 'setAssistantGrant', player: seat, goodType, enabled },
        );
      }
      return true;
    },
  };
}

/** Grants start enabled in a playable map only; scenes keep the sim default of nothing granted. */
export function grantAssistantDefaults(
  sim: WorldSetup,
  content: GrantContent,
  players: readonly number[],
): void {
  const grantGoods = resolveGrantGoods(content);
  for (const player of new Set(players)) {
    for (const id of GOOD_SWITCH_IDS) {
      if (isWeaponSwitch(id)) continue; // every weapon starts allowed: the sim default, no veto
      for (const goodType of grantGoods[id]) {
        sim.enqueueSetup({ kind: 'setAssistantGrant', player, goodType, enabled: true });
      }
    }
  }
}
