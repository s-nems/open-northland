import type { PlacementGhost, PlacementOverlayFrame } from '@open-northland/render';
import type { Paper } from '@open-northland/sim';

export interface PlacementCursor {
  readonly overlay: PlacementOverlayFrame | null;
  readonly ghost: PlacementGhost | null;
}

export interface PlacementCursorInput {
  /** The building the tool panel holds, or null outside build mode. */
  readonly placementType: number | null;
  /** The paper paying for this placement, which bypasses the technology part of the live probe. */
  readonly placementPaper: Paper | null;
  readonly signpostActive: boolean;
  /** Viewport-memoized band probes; each runs only when its own mode wins, so a frame never walks a
   *  band it would discard. */
  readonly buildingOverlay: (buildingType: number) => PlacementOverlayFrame | null;
  readonly signpostOverlay: () => PlacementOverlayFrame | null;
  /** The tile under the cursor, or null off the map or off the canvas. */
  readonly tileAt: () => { readonly col: number; readonly row: number } | null;
  readonly canPlaceAt: (typeId: number, col: number, row: number, paper?: Paper) => boolean;
  readonly canPlaceSignpostAt: (col: number, row: number) => boolean;
  /** Owner slot for a signpost ghost - the renderer applies the session colour mapping. */
  readonly localPlayer: number;
  /** The civilization this seat raises buildings as, the same one `placeBuilding` stamps. */
  readonly placementTribe: number;
}

/**
 * The ghost stays hidden over ground that rejects it, matching the original's vanishing house cursor.
 * A held building takes precedence over a pending signpost.
 */
export function placementCursor(input: PlacementCursorInput): PlacementCursor {
  const { placementType } = input;
  const signpostFrame = placementType === null && input.signpostActive ? input.signpostOverlay() : null;
  const overlay = placementType === null ? signpostFrame : input.buildingOverlay(placementType);
  if (placementType === null && signpostFrame === null) return { overlay, ghost: null };

  const tile = input.tileAt();
  if (tile === null) return { overlay, ghost: null };
  if (placementType !== null) {
    return input.canPlaceAt(
      placementType,
      tile.col,
      tile.row,
      input.placementPaper === null ? undefined : input.placementPaper,
    )
      ? {
          overlay,
          ghost: {
            kind: 'building',
            col: tile.col,
            row: tile.row,
            buildingType: placementType,
            tribe: input.placementTribe,
          },
        }
      : { overlay, ghost: null };
  }
  return input.canPlaceSignpostAt(tile.col, tile.row)
    ? { overlay, ghost: { kind: 'signpost', col: tile.col, row: tile.row, player: input.localPlayer } }
    : { overlay, ghost: null };
}
