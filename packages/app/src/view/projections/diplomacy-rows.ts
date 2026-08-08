import type { DiplomacyState } from '@open-northland/sim';
import { PLAYER_SWATCH_COLORS } from '../../catalog/roster.js';
import type { DiplomacyPanelRow } from '../../hud/tool-panel/diplomacy/index.js';

/** The two sim reads the roster projection needs; `Simulation` satisfies it structurally. */
export interface DiplomacySimView {
  hasMetPlayer(viewer: number, other: number): boolean;
  diplomacyStance(from: number, to: number): DiplomacyState;
}

export interface DiplomacyRosterOptions {
  readonly localPlayer: number;
  /** The map roster's player slots; the window lists the discovered ones. */
  readonly rosterPlayers: readonly number[];
  /** A spectator sees the whole map, so the discovery gate is skipped. */
  readonly observer: boolean;
  readonly seatNameOf?: (player: number) => string | undefined;
  /** Owner slot to team-colour slot; identity when the roster authored no colours. */
  readonly playerColourOf?: (player: number) => number;
}

/** One diplomacy-window row per roster player the viewer has discovered, the viewer itself excluded. */
export function diplomacyPanelRows(sim: DiplomacySimView, opts: DiplomacyRosterOptions): DiplomacyPanelRow[] {
  const colourOf = opts.playerColourOf ?? ((player: number): number => player);
  const rows: DiplomacyPanelRow[] = [];
  for (const other of opts.rosterPlayers) {
    if (other === opts.localPlayer) continue;
    if (!opts.observer && !sim.hasMetPlayer(opts.localPlayer, other)) continue;
    const name = opts.seatNameOf?.(other);
    rows.push({
      player: other,
      ...(name !== undefined ? { name } : {}),
      colour: PLAYER_SWATCH_COLORS[colourOf(other)] ?? 0,
      towardYou: sim.diplomacyStance(other, opts.localPlayer),
      yourStance: sim.diplomacyStance(opts.localPlayer, other),
    });
  }
  return rows;
}
