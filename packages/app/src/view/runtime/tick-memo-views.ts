import type { OpenTribute, Simulation } from '@open-northland/sim';
import { type BuildingAvailability, OPEN_AVAILABILITY } from '../../hud/tool-panel/building-menu.js';
import type { DiplomacySimView } from '../projections/diplomacy-rows.js';

/** A house's place in the construction window: banned entries are never listed, undiscovered ones
 *  wait at the end. */
function technologyAvailability(status: ReturnType<Simulation['unlockStatus']>): BuildingAvailability {
  if (!status.allowed) return { kind: 'forbidden' };
  return status.enabled ? OPEN_AVAILABILITY : { kind: 'locked' };
}

/**
 * The sim reads an open HUD window pulls every frame, memoized per tick: the tribute probe walks the
 * payer's houses and the unlock reason builds strings, and nothing either reads moves between ticks.
 */
export function createTickMemoViews(
  sim: Simulation,
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
  let reasonMemo: { readonly tick: number; readonly reasons: Map<string, BuildingAvailability> } | null =
    null;
  return {
    diplomacyView: {
      hasMetPlayer: (viewer, other) => sim.hasMetPlayer(viewer, other),
      diplomacyStance: (from, to) => sim.diplomacyStance(from, to),
      diplomacyLocked: (a, b) => sim.diplomacyLocked(a, b),
      goodsTradedWith: (player, partner) => sim.goodsTradedWith(player, partner),
      openTributes: (payer) => {
        if (owedMemo === null || owedMemo.tick !== sim.tick || owedMemo.payer !== payer) {
          owedMemo = { tick: sim.tick, payer, owed: sim.openTributes(payer) };
        }
        return owedMemo.owed;
      },
    },
    buildAvailability: (player, typeId) => {
      if (reasonMemo === null || reasonMemo.tick !== sim.tick)
        reasonMemo = { tick: sim.tick, reasons: new Map() };
      const key = `${player}:${typeId}`;
      const known = reasonMemo.reasons.get(key);
      if (known !== undefined) return known;
      const availability = technologyAvailability(sim.unlockStatus('house', typeId, tribeOf(player), player));
      reasonMemo.reasons.set(key, availability);
      return availability;
    },
  };
}
