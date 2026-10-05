import type { MapRelationFlag } from '@open-northland/data';
import type { DiplomacyState, PlayerCommand } from '@open-northland/sim';
import type { SessionHost } from '../session/index.js';
import { relationFlagged } from './projections/diplomacy-rows.js';

export interface DiplomacyActionDeps {
  readonly host: Pick<SessionHost, 'hasMetPlayer' | 'diplomacyLocked' | 'openTributes'>;
  readonly viewer: () => number | null;
  readonly canCommand: () => boolean;
  readonly wholeMap: () => boolean;
  readonly roster: readonly number[];
  readonly flags: readonly MapRelationFlag[];
  readonly submit: (command: PlayerCommand) => void;
}

/** Clicks ask the host again; a cached stock or lock answer never authorizes an order. */
export function createDiplomacyActions(deps: DiplomacyActionDeps) {
  const allowed = (player: number, other: number): boolean =>
    deps.canCommand() &&
    deps.viewer() === player &&
    player !== other &&
    deps.roster.includes(other) &&
    !relationFlagged(deps.flags, 'hide', player, other) &&
    (deps.wholeMap() || deps.host.hasMetPlayer(player, other));
  return {
    async declare(other: number, state: DiplomacyState): Promise<boolean> {
      const player = deps.viewer();
      if (
        player === null ||
        !allowed(player, other) ||
        relationFlagged(deps.flags, 'hideDetails', player, other)
      )
        return false;
      const locked = await deps.host.diplomacyLocked(player, other);
      if (locked || !allowed(player, other)) return false;
      deps.submit({ kind: 'declareDiplomacy', player, other, state });
      return true;
    },
    async pay(other: number, slot: number): Promise<boolean> {
      const player = deps.viewer();
      if (player === null || !allowed(player, other)) return false;
      const tributes = await deps.host.openTributes(player);
      if (
        !allowed(player, other) ||
        !tributes.some((t) => t.slot === slot && t.receiver === other && t.payable)
      )
        return false;
      deps.submit({ kind: 'payTribute', player, slot });
      return true;
    },
  };
}
