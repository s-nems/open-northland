import type { MapRelationFlag } from '@open-northland/data';
import type { DiplomacyState, OpenTribute } from '@open-northland/sim';
import { PLAYER_SWATCH_COLORS } from '../../catalog/roster.js';
import type { DiplomacyPanelRow, TributePanelRow } from '../../hud/tool-panel/diplomacy/index.js';

/** The sim reads the roster projection needs; `Simulation` satisfies it structurally. */
export interface DiplomacySimView {
  hasMetPlayer(viewer: number, other: number): boolean;
  diplomacyStance(from: number, to: number): DiplomacyState;
  diplomacyLocked(a: number, b: number): boolean;
  /** The open tributes `payer` owes, as the sim's probe lists them. */
  openTributes(payer: number): readonly OpenTribute[];
  /** The units `player`'s traders took out of `partner`'s houses under a trade agreement. */
  goodsTradedWith(player: number, partner: number): number;
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
  /** The map's own string for a tribute's description; absent leaves the numbered fallback. */
  readonly tributeText?: (stringId: number) => string | undefined;
  /** A good's display label; absent leaves the type id. */
  readonly goodLabelOf?: (goodType: number) => string | undefined;
  /** Whether the viewer's seat may issue a payment at all; a read-only spectator's buttons stay dead. */
  readonly canPay?: boolean;
  /** Whether the viewer's seat may declare a stance at all, as `canPay` for payments. */
  readonly canDeclare?: boolean;
  /** The map's `[playermisc]` relation rows: a `hide` pair drops each player from the other's window,
   *  a `hideDetails` pair takes away the stance buttons (the original gives that player no page). */
  readonly relationFlags?: readonly MapRelationFlag[];
}

/**
 * The harshest stance standing between the viewer and the roster players it has met, either
 * direction: `enemy` if anyone is hostile, `friend` only if everyone met is friendly, else `neutral`.
 * A viewer that has met nobody stands `neutral`. Approximation: the original's own rule for picking a
 * theme's mood is not readable, so this collapses the roster the way the diplomacy window reads it.
 */
export function harshestStance(
  sim: Pick<DiplomacySimView, 'hasMetPlayer' | 'diplomacyStance'>,
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

function flagged(
  flags: readonly MapRelationFlag[],
  kind: MapRelationFlag['kind'],
  a: number,
  b: number,
): boolean {
  return flags.some((f) => f.kind === kind && ((f.a === a && f.b === b) || (f.a === b && f.b === a)));
}

/** One diplomacy-window row per roster player the viewer has discovered and the map does not hide, the
 *  viewer itself excluded, each carrying the tributes the viewer owes that player. */
export function diplomacyPanelRows(sim: DiplomacySimView, opts: DiplomacyRosterOptions): DiplomacyPanelRow[] {
  const colourOf = opts.playerColourOf ?? ((player: number): number => player);
  const flags = opts.relationFlags ?? [];
  const local = opts.localPlayer;
  const owed = sim.openTributes(local);
  const rows: DiplomacyPanelRow[] = [];
  for (const other of opts.rosterPlayers) {
    if (other === local || flagged(flags, 'hide', local, other)) continue;
    if (!opts.observer && !sim.hasMetPlayer(local, other)) continue;
    const name = opts.seatNameOf?.(other);
    const towardYou = sim.diplomacyStance(other, local);
    const yourStance = sim.diplomacyStance(local, other);
    const friends = towardYou === 'friend' && yourStance === 'friend';
    rows.push({
      player: other,
      ...(name !== undefined ? { name } : {}),
      colour: PLAYER_SWATCH_COLORS[colourOf(other)] ?? 0,
      towardYou,
      yourStance,
      ...(friends ? { goodsTraded: sim.goodsTradedWith(local, other) } : {}),
      canDeclare:
        opts.canDeclare !== false &&
        !sim.diplomacyLocked(local, other) &&
        !flagged(flags, 'hideDetails', local, other),
      tributes: owed.filter((t) => t.receiver === other).map((t) => tributeRow(t, opts)),
    });
  }
  return rows;
}

function tributeRow(tribute: OpenTribute, opts: DiplomacyRosterOptions): TributePanelRow {
  const text = opts.tributeText?.(tribute.stringId);
  return {
    slot: tribute.slot,
    ...(text !== undefined ? { text } : {}),
    demands: tribute.demands.map((d) => ({
      label: opts.goodLabelOf?.(d.good) ?? String(d.good),
      amount: d.amount,
      onHand: d.onHand,
    })),
    payable: tribute.payable && opts.canPay !== false,
  };
}
