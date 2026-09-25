import type { Paper, Simulation } from '@open-northland/sim';
import type { PalisadeGateProbeView } from '../../hud/tool-panel/placement.js';
import type { FogGates } from '../projections/index.js';

/** The live placement rules the click gates and the cursor ghosts share. */
export interface PlacementGates {
  readonly canPlaceAt: (typeId: number, col: number, row: number, paper?: Paper) => boolean;
  readonly canPlaceSignpostAt: (col: number, row: number) => boolean;
  readonly canPlacePalisadeAt: (gfxIndex: number, col: number, row: number) => boolean;
  readonly palisadeGateProbe: (gfxIndex: number, col: number, row: number) => PalisadeGateProbeView | null;
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
  const closedGates = (sim.terrain?.landscapes?.types ?? [])
    .filter((type) => type.wall?.gate?.open === false)
    .map((type) => type.typeId);
  return {
    // A paper bypasses only technology; fog, footprint and contested-ground rules still apply.
    canPlaceAt: (typeId, col, row, paper) =>
      fogGates.seesNode(col, row) &&
      (sim.placementProbe(typeId, localPlayer, paper === undefined ? tribe : undefined)?.canPlace(col, row) ??
        true),
    canPlaceSignpostAt: (col, row) =>
      fogGates.seesNode(col, row) && (sim.signpostProbe(localPlayer)?.canPlace(col, row) ?? false),
    canPlacePalisadeAt: (gfxIndex, col, row) =>
      fogGates.seesNode(col, row) && (sim.palisadeProbe(gfxIndex)?.canPlace(col, row) ?? false),
    palisadeGateProbe: (_gfxIndex, col, row) =>
      fogGates.seesNode(col, row) ? sim.palisadeGateProbe(col, row, closedGates, localPlayer) : null,
  };
}
