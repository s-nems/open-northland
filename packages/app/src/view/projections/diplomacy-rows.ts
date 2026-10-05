import type { MapRelationFlag } from '@open-northland/data';
import type { DiplomacyState, OpenTribute, TradeOffer } from '@open-northland/sim';
import { PLAYER_SWATCH_COLORS } from '../../catalog/roster.js';
import type {
  DeclarationBlock,
  DiplomacyGood,
  DiplomacyOffer,
  DiplomacyPanelRow,
  TributePanelRow,
} from '../../hud/dom/diplomacy-window/model.js';
import type { MetSeat } from '../../hud/tool-panel/messages/index.js';
import type { SessionHost } from '../../session/index.js';

/** The world reads the roster projection needs, answered synchronously: the stances and the met
 *  flags are per-frame host reads, the rest the last answers a `LastAnswerCache` holds. */
export interface DiplomacySimView extends Pick<SessionHost, 'hasMetPlayer' | 'diplomacyStance'> {
  diplomacyLocked(a: number, b: number): boolean | undefined;
  goodsTradedWith(player: number, partner: number): number;
  openTributes(payer: number): readonly OpenTribute[];
  tradeOffersOf(partner: number): readonly TradeOffer[];
}

export interface DiplomacyRosterOptions {
  readonly localPlayer: number;
  /** The map roster's player slots; the window lists the discovered ones. */
  readonly rosterPlayers: readonly number[];
  /** A spectator sees the whole map, so the discovery gate is skipped. */
  readonly observer: boolean;
  readonly seatNameOf?: (player: number) => string | undefined;
  readonly tribeOf?: (player: number) => number;
  /** Owner slot to team-colour slot; identity when the roster authored no colours. */
  readonly playerColourOf?: (player: number) => number;
  /** A good's display label; absent leaves the type id. */
  readonly goodLabelOf?: (goodType: number) => string | undefined;
  readonly goodIdOf?: (goodType: number) => string | undefined;
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

export function relationFlagged(
  flags: readonly MapRelationFlag[],
  kind: MapRelationFlag['kind'],
  a: number,
  b: number,
): boolean {
  return flags.some((f) => f.kind === kind && ((f.a === a && f.b === b) || (f.a === b && f.b === a)));
}

/** The roster players the viewer has discovered and the map does not hide, the viewer itself excluded. */
function listedPlayers(
  sim: Pick<DiplomacySimView, 'hasMetPlayer'>,
  opts: Pick<DiplomacyRosterOptions, 'localPlayer' | 'rosterPlayers' | 'observer' | 'relationFlags'>,
): number[] {
  const flags = opts.relationFlags ?? [];
  const local = opts.localPlayer;
  return opts.rosterPlayers.filter(
    (other) =>
      other !== local &&
      !relationFlagged(flags, 'hide', local, other) &&
      (opts.observer || sim.hasMetPlayer(local, other)),
  );
}

/** The seats {@link diplomacyPanelRows} lists, with only the stance toward the viewer: the per-tick read
 *  of the message centre, which leaves the window's tributes and trade lines unbuilt. */
export function diplomacyMetSeats(
  sim: Pick<DiplomacySimView, 'hasMetPlayer' | 'diplomacyStance'>,
  opts: Pick<DiplomacyRosterOptions, 'localPlayer' | 'rosterPlayers' | 'observer' | 'relationFlags'>,
): MetSeat[] {
  return listedPlayers(sim, opts).map((player) => ({
    player,
    towardYou: sim.diplomacyStance(player, opts.localPlayer),
  }));
}

/** One diplomacy-window row per listed player, each carrying the tributes the viewer owes that player. */
export function diplomacyPanelRows(sim: DiplomacySimView, opts: DiplomacyRosterOptions): DiplomacyPanelRow[] {
  const colourOf = opts.playerColourOf ?? ((player: number): number => player);
  const flags = opts.relationFlags ?? [];
  const local = opts.localPlayer;
  const owed = sim.openTributes(local);
  const rows: DiplomacyPanelRow[] = [];
  for (const other of listedPlayers(sim, opts)) {
    const name = opts.seatNameOf?.(other);
    const towardYou = sim.diplomacyStance(other, local);
    const yourStance = sim.diplomacyStance(local, other);
    const friends = towardYou === 'friend' && yourStance === 'friend';
    const tribe = opts.tribeOf?.(other);
    const lock = sim.diplomacyLocked(local, other);
    const blocked: DeclarationBlock | undefined =
      opts.canDeclare === false
        ? 'observer'
        : relationFlagged(flags, 'hideDetails', local, other)
          ? 'details'
          : lock === undefined
            ? 'loading'
            : lock
              ? 'script'
              : undefined;
    rows.push({
      player: other,
      ...(name !== undefined ? { name } : {}),
      ...(tribe !== undefined ? { tribe } : {}),
      colour: PLAYER_SWATCH_COLORS[colourOf(other)] ?? 0,
      towardYou,
      yourStance,
      ...(friends ? { goodsTraded: sim.goodsTradedWith(local, other) } : {}),
      canDeclare: blocked === undefined,
      ...(blocked !== undefined ? { blocked } : {}),
      tributes: owed.filter((t) => t.receiver === other).map((t) => tributeRow(t, opts)),
      tradeOffers: sim.tradeOffersOf(other).map((offer) => tradeOfferRow(offer, opts)),
    });
  }
  return rows;
}

function goodRow(goodType: number, amount: number, opts: DiplomacyRosterOptions): DiplomacyGood {
  const goodId = opts.goodIdOf?.(goodType);
  return {
    goodType,
    amount,
    label: opts.goodLabelOf?.(goodType) ?? String(goodType),
    ...(goodId !== undefined ? { goodId } : {}),
  };
}

function tradeOfferRow(offer: TradeOffer, opts: DiplomacyRosterOptions): DiplomacyOffer {
  return {
    index: offer.index,
    give: goodRow(offer.giveGood, offer.giveAmount, opts),
    take: goodRow(offer.takeGood, offer.takeAmount, opts),
  };
}

function tributeRow(tribute: OpenTribute, opts: DiplomacyRosterOptions): TributePanelRow {
  return {
    slot: tribute.slot,
    demands: tribute.demands.map((d) => ({
      ...goodRow(d.good, d.amount, opts),
      onHand: d.onHand,
    })),
    payable: tribute.payable && opts.canPay !== false,
  };
}
