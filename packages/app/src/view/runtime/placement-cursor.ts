import type { PlacementGhost, PlacementOverlayFrame } from '@open-northland/render';

/** What the held placement paints this frame: the ground wash, and the cursor ghost over a legal tile. */
export interface PlacementCursor {
  readonly overlay: PlacementOverlayFrame | null;
  readonly ghost: PlacementGhost | null;
}

export interface PlacementCursorInput {
  /** The building the tool panel holds, or null outside build mode. */
  readonly placementType: number | null;
  /** The scout's erect-signpost click is pending. */
  readonly signpostActive: boolean;
  /** This frame's band probes, viewport-memoized: each is called only when its own mode wins, so a
   *  frame never walks a band it would then discard. */
  readonly buildingOverlay: (buildingType: number) => PlacementOverlayFrame | null;
  readonly signpostOverlay: () => PlacementOverlayFrame | null;
  /** The tile under the cursor, or null off the map / off the canvas. Consulted only once something is
   *  actually drawn to place: a held building, or a signpost whose band probe produced a wash. */
  readonly tileAt: () => { readonly col: number; readonly row: number } | null;
  readonly canPlaceAt: (typeId: number, col: number, row: number) => boolean;
  readonly canPlaceSignpostAt: (col: number, row: number) => boolean;
  /** Owner slot for a signpost ghost — the renderer applies the session colour mapping. */
  readonly localPlayer: number;
}

/**
 * What the cursor holds this frame. Build mode and the pending signpost share one wash (dim exactly where
 * the thing would be refused) and one ghost, which stays hidden over rejecting ground — the original's
 * vanishing house cursor. A held building wins over a pending signpost: it is the more specific intent.
 */
export function placementCursor(input: PlacementCursorInput): PlacementCursor {
  const { placementType } = input;
  const signpostFrame = placementType === null && input.signpostActive ? input.signpostOverlay() : null;
  const overlay = placementType === null ? signpostFrame : input.buildingOverlay(placementType);
  if (placementType === null && signpostFrame === null) return { overlay, ghost: null };

  const tile = input.tileAt();
  if (tile === null) return { overlay, ghost: null };
  if (placementType !== null) {
    return input.canPlaceAt(placementType, tile.col, tile.row)
      ? { overlay, ghost: { kind: 'building', col: tile.col, row: tile.row, buildingType: placementType } }
      : { overlay, ghost: null };
  }
  return input.canPlaceSignpostAt(tile.col, tile.row)
    ? { overlay, ghost: { kind: 'signpost', col: tile.col, row: tile.row, player: input.localPlayer } }
    : { overlay, ghost: null };
}
