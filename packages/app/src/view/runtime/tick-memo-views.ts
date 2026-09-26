import type { OpenTribute, TradeOffer, UnlockStatus } from '@open-northland/sim';
import { type BuildingAvailability, OPEN_AVAILABILITY } from '../../hud/tool-panel/building-menu.js';
import type { SessionHost } from '../../session/index.js';
import type { DiplomacySimView } from '../projections/diplomacy-rows.js';

/** A house's place in the construction window: banned entries are never listed, undiscovered ones
 *  wait at the end. */
function technologyAvailability(status: UnlockStatus): BuildingAvailability {
  if (!status.allowed) return { kind: 'forbidden' };
  return status.enabled ? OPEN_AVAILABILITY : { kind: 'locked' };
}

/**
 * The host reads an open HUD window pulls every frame, memoized per tick: the tribute probe walks the
 * payer's houses and the unlock reason builds strings, and nothing either reads moves between ticks.
 */
export function createTickMemoViews(
  host: SessionHost,
  tribeOf: (player: number) => number,
): {
  readonly diplomacyView: DiplomacySimView;
  readonly buildAvailability: (player: number, typeId: number) => BuildingAvailability;
} {
  let owedMemo: {
    readonly tick: number;
    readonly payer: number;
    readonly owed: readonly OpenTribute[];
  } | null = null;
  let offersMemo: { readonly tick: number; readonly byPartner: Map<number, readonly TradeOffer[]> } | null =
    null;
  let reasonMemo: { readonly tick: number; readonly reasons: Map<string, BuildingAvailability> } | null =
    null;
  return {
    diplomacyView: {
      hasMetPlayer: (viewer, other) => host.hasMetPlayer(viewer, other),
      diplomacyStance: (from, to) => host.diplomacyStance(from, to),
      diplomacyLocked: (a, b) => host.diplomacyLocked(a, b),
      goodsTradedWith: (player, partner) => host.goodsTradedWith(player, partner),
      tradeOffersOf: (partner) => {
        if (offersMemo === null || offersMemo.tick !== host.tick) {
          offersMemo = { tick: host.tick, byPartner: new Map() };
        }
        let offers = offersMemo.byPartner.get(partner);
        if (offers === undefined) {
          offers = host.tradeOffersOf(partner);
          offersMemo.byPartner.set(partner, offers);
        }
        return offers;
      },
      openTributes: (payer) => {
        if (owedMemo === null || owedMemo.tick !== host.tick || owedMemo.payer !== payer) {
          owedMemo = { tick: host.tick, payer, owed: host.openTributes(payer) };
        }
        return owedMemo.owed;
      },
    },
    buildAvailability: (player, typeId) => {
      if (reasonMemo === null || reasonMemo.tick !== host.tick)
        reasonMemo = { tick: host.tick, reasons: new Map() };
      const key = `${player}:${typeId}`;
      const known = reasonMemo.reasons.get(key);
      if (known !== undefined) return known;
      const availability = technologyAvailability(
        host.unlockStatus('house', typeId, tribeOf(player), player),
      );
      reasonMemo.reasons.set(key, availability);
      return availability;
    },
  };
}
