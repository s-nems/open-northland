import type { PlacementGhost, PlacementOverlayFrame } from '@open-northland/render';
import type { Paper } from '@open-northland/sim';
import type { LinePreviewNode } from '../../hud/tool-panel/line-tool.js';
import type { GatePreview } from '../../hud/tool-panel/placement.js';

export interface PlacementCursor {
  readonly overlay: PlacementOverlayFrame | null;
  readonly ghost: PlacementGhost | null;
}

export interface PlacementCursorInput {
  /** The building the tool panel holds, or null outside build mode. */
  readonly placementType: number | null;
  /** The paper paying for this placement, which bypasses the technology part of the live probe. */
  readonly placementPaper: Paper | null;
  readonly palisadeGfxIndex?: number | null;
  readonly signpostActive: boolean;
  /** Viewport-memoized band probes; each runs only when its own mode wins, so a frame never walks a
   *  band it would discard. */
  readonly buildingOverlay: (buildingType: number, paper?: Paper) => PlacementOverlayFrame | null;
  readonly signpostOverlay: () => PlacementOverlayFrame | null;
  /** The tile under the cursor, or null off the map or off the canvas. */
  readonly tileAt: () => { readonly col: number; readonly row: number } | null;
  readonly canPlaceAt: (typeId: number, col: number, row: number, paper?: Paper) => boolean;
  readonly canPlaceSignpostAt: (col: number, row: number) => boolean;
  readonly palisadePreview?: (tile: {
    readonly col: number;
    readonly row: number;
  }) => readonly LinePreviewNode[] | null;
  /** The gate tool's gate under the cursor, which draws in place of span markers. */
  readonly gatePreview?: (tile: { readonly col: number; readonly row: number }) => GatePreview | null;
  /** A line has its first click, so the preview's first node marks where it starts. */
  readonly anchored?: boolean;
  /** The palisade tool's wash: a started line's reach or the gate tool's spans, null when it has none. */
  readonly palisadeWash?: () => PlacementOverlayFrame | null;
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
  const palisadeGfxIndex = input.palisadeGfxIndex ?? null;
  const signpostFrame =
    placementType === null && palisadeGfxIndex === null && input.signpostActive
      ? input.signpostOverlay()
      : null;
  const paper = input.placementPaper === null ? undefined : input.placementPaper;
  const overlay = placementType === null ? signpostFrame : input.buildingOverlay(placementType, paper);
  if (placementType === null && palisadeGfxIndex === null && signpostFrame === null)
    return { overlay, ghost: null };

  const tile = input.tileAt();
  if (palisadeGfxIndex !== null) {
    // The wash stays while the pointer leaves the map; only the markers need a tile.
    const overlay = input.palisadeWash?.() ?? null;
    const gate = tile === null ? null : (input.gatePreview?.(tile) ?? null);
    if (gate !== null) return { overlay, ghost: { kind: 'gate', ...gate } };
    const nodes = tile === null ? null : (input.palisadePreview?.(tile) ?? null);
    return {
      overlay,
      ghost: nodes === null ? null : { kind: 'line', nodes, anchored: input.anchored === true },
    };
  }
  if (tile === null) return { overlay, ghost: null };
  if (placementType !== null) {
    return input.canPlaceAt(placementType, tile.col, tile.row, paper)
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
