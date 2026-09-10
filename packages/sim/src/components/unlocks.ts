import { insertSortedById } from '../core/sorted-id.js';
import type { DeepReadonly, World } from '../ecs/world.js';
import { defineWorldSingleton } from '../ecs/world-singleton.js';
import { isValidPlayer } from './ownership.js';

/** The catalogs a map script unlocks by name; ships have no opcode. */
export type UnlockKind = 'job' | 'house' | 'good';

/** Which of a player's two tables a line writes: `Allow*` grants permission, `Enable*` grants progress. */
export type UnlockTable = 'allowed' | 'enabled';

/** One tribe's script-granted type ids under one player. Each list is ascending and duplicate-free, so
 *  the same grants hash the same whatever order the script issued them in. */
export interface TribeUnlocks {
  allowed: Record<UnlockKind, number[]>;
  enabled: Record<UnlockKind, number[]>;
}

/** Keyed by player, then by the tribe the line named. */
const scriptUnlocks = defineWorldSingleton<{ byPlayer: Map<number, Map<number, TribeUnlocks>> }>(
  'ScriptUnlocks',
  () => ({ byPlayer: new Map() }),
);

export const ScriptUnlocks = scriptUnlocks.component;

function tribeUnlocks(
  world: World,
  player: number | undefined,
  tribe: number,
): DeepReadonly<TribeUnlocks> | undefined {
  if (player === undefined) return undefined;
  return scriptUnlocks.read(world).byPlayer.get(player)?.get(tribe);
}

/** Whether a script line let `player`'s `tribe` take up, build or make the type at all. */
export function scriptAllows(
  world: World,
  player: number | undefined,
  tribe: number,
  kind: UnlockKind,
  typeId: number,
): boolean {
  return tribeUnlocks(world, player, tribe)?.allowed[kind].includes(typeId) ?? false;
}

/** Whether a script line marked the type unlocked for `player`'s `tribe`, whatever its settlers know. */
export function scriptEnables(
  world: World,
  player: number | undefined,
  tribe: number,
  kind: UnlockKind,
  typeId: number,
): boolean {
  return tribeUnlocks(world, player, tribe)?.enabled[kind].includes(typeId) ?? false;
}

/** Grant one type in one table. A repeat grant writes nothing, so it bumps no store generation; an
 *  invalid slot is the corpus's own bad argument and is skipped. */
export function grantScriptUnlock(
  world: World,
  table: UnlockTable,
  player: number,
  tribe: number,
  kind: UnlockKind,
  typeId: number,
): void {
  if (!isValidPlayer(player)) return;
  if (tribeUnlocks(world, player, tribe)?.[table][kind].includes(typeId)) return;
  scriptUnlocks.write(world, (state) => {
    let tribes = state.byPlayer.get(player);
    if (tribes === undefined) {
      tribes = new Map();
      state.byPlayer.set(player, tribes);
    }
    let held = tribes.get(tribe);
    if (held === undefined) {
      held = {
        allowed: { job: [], house: [], good: [] },
        enabled: { job: [], house: [], good: [] },
      };
      tribes.set(tribe, held);
    }
    insertSortedById(held[table][kind], typeId, (id) => id);
  });
}
