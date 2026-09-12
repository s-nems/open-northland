import type { Simulation } from '@open-northland/sim';
import type { FogGates } from '../projections/index.js';

/** The live placement rules the click gates and the cursor ghosts share. */
export interface PlacementGates {
  readonly canPlaceAt: (typeId: number, col: number, row: number) => boolean;
  readonly canPlaceSignpostAt: (col: number, row: number) => boolean;
}

/**
 * Click gate and cursor ghost both read these, so a ghost cannot preview what a click would refuse.
 * A mapless sim has no probe: buildings place freely, signposts never do. The fog rule is app-side
 * only (genre convention, not the original), so the ungated sim command still serves admin spawns.
 */
export function createPlacementGates(
  sim: Simulation,
  fogGates: FogGates,
  localPlayer: number,
  tribe?: number,
): PlacementGates {
  return {
    canPlaceAt: (typeId, col, row) =>
      (tribe === undefined || sim.unlockStatus('house', typeId, tribe, localPlayer).enabled) &&
      fogGates.seesNode(col, row) &&
      (sim.placementProbe(typeId, localPlayer, tribe)?.canPlace(col, row) ?? true),
    canPlaceSignpostAt: (col, row) =>
      fogGates.seesNode(col, row) && (sim.signpostProbe(localPlayer)?.canPlace(col, row) ?? false),
  };
}
