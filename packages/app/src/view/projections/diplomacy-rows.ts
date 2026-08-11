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

/**
 * The harshest stance standing between the viewer and the roster players it has met, either
 * direction: `enemy` if anyone is hostile, `friend` only if everyone met is friendly, else `neutral`.
 * A viewer that has met nobody stands `neutral`. Approximation: the original's own rule for picking a
 * theme's mood is not readable, so this collapses the roster the way the diplomacy window reads it.
 */
export function harshestStance(
  sim: DiplomacySimView,
  opts: Pick<DiplomacyRosterOptions, 'localPlayer' | 'rosterPlayers' | 'observer'>,
): DiplomacyState {
  let met = 0;
  let friendly = 0;
  for (const other of opts.rosterPlayers) {
    if (other === opts.localPlayer) continue;
    if (opts.observer !== true && !sim.hasMetPlayer(opts.localPlayer, other)) continue;
    met++;
    const ours = sim.diplomacyStance(opts.localPlayer, other);
    const theirs = sim.diplomacyStance(other, opts.localPlayer);
    if (ours === 'enemy' || theirs === 'enemy') return 'enemy';
    if (ours === 'friend' && theirs === 'friend') friendly++;
  }
  return met > 0 && friendly === met ? 'friend' : 'neutral';
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
