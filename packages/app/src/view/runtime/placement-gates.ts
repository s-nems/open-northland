import type { Simulation } from '@open-northland/sim';
import type { FogGates } from '../projections/index.js';

/** The live placement rules the click gates and the cursor ghosts share. */
export interface PlacementGates {
  /** The one live building-placement rule the click gate and the cursor ghost share. */
  readonly canPlaceAt: (typeId: number, col: number, row: number) => boolean;
  /** The erect-signpost twin of {@link canPlaceAt} — gates the signpost cursor ghost. */
  readonly canPlaceSignpostAt: (col: number, row: number) => boolean;
}

/**
 * The placement gates for a game view. Click gate and cursor ghost must never drift — the ghost previews
 * exactly what a click will do — so both read these. A mapless sim (no probe) places buildings freely,
 * matching the command gate's stance, and shows no signpost ghost (the erect would be a no-op there).
 * Under fog, ground the player does not currently see rejects the anchor — our modern gate (genre
 * convention: no founding into the fog), applied app-side only: the sim command stays ungated so
 * admin/scenario spawns bypass the UI rule.
 */
export function createPlacementGates(
  sim: Simulation,
  fogGates: FogGates,
  localPlayer: number,
): PlacementGates {
  return {
    canPlaceAt: (typeId, col, row) =>
      fogGates.seesNode(col, row) && (sim.placementProbe(typeId)?.canPlace(col, row) ?? true),
    canPlaceSignpostAt: (col, row) =>
      fogGates.seesNode(col, row) && (sim.signpostProbe(localPlayer)?.canPlace(col, row) ?? false),
  };
}
