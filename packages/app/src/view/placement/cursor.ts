import type { BerthMark, PlacementGhost, PlacementOverlayFrame } from '@open-northland/render';
import type { LinePreviewNode } from '../../hud/tool-panel/line-tool.js';
import {
  type BuildingPick,
  type GatePreview,
  probeOwner,
  type RoadPreview,
  techWaived,
} from '../../hud/tool-panel/placement.js';

export interface PlacementCursor {
  readonly overlay: PlacementOverlayFrame | null;
  readonly ghost: PlacementGhost | null;
}

export interface PlacementCursorInput {
  /** The building the tool panel holds, or null outside build mode; its nation picks the ghost's body
   *  and footprint, its waiver ({@link techWaived}) the technology part of the live probe, and an admin
   *  pick's owner ({@link probeOwner}) whose ground rule it reads. */
  readonly building: BuildingPick | null;
  readonly palisadeGfxIndex?: number | null;
  /** The road tool is held. */
  readonly roadActive?: boolean;
  readonly signpostActive: boolean;
  /** The ship whose dock pick is armed, or null. */
  readonly dockVehicle: number | null;
  /** The shore points a dock click at a tile would moor its ships at (the armed dock pick's, or the
   *  selected ships' right-click), empty where it docks nothing. Absent, no berth shows. */
  readonly berthsAt?: (tile: { readonly col: number; readonly row: number }) => readonly BerthMark[];
  /** A pick that plants a work flag is armed: the flag follows the cursor until the click plants it or,
   *  for a flag trade's workplace pick, names a building. */
  readonly flagActive: boolean;
  /** The barracks rally-point pick is armed ({@link flagActive} is too): the flag ghost follows the
   *  cursor tinted as the rally flag, not the plain work one. */
  readonly rallyActive?: boolean;
  /** Viewport-memoized band probes; each runs only when its own mode wins, so a frame never walks a
   *  band it would discard. */
  readonly buildingOverlay: (building: BuildingPick) => PlacementOverlayFrame | null;
  readonly signpostOverlay: () => PlacementOverlayFrame | null;
  readonly dockOverlay: (vehicle: number) => PlacementOverlayFrame | null;
  /** The tile under the cursor, or null off the map or off the canvas. */
  readonly tileAt: () => { readonly col: number; readonly row: number } | null;
  readonly canPlaceAt: (
    typeId: number,
    tribe: number,
    col: number,
    row: number,
    techWaived?: boolean,
    owner?: number,
  ) => boolean;
  /** How far a held building would shoot in defence mode from a node, undefined for a type without one. */
  readonly defenceRangeAt?: (typeId: number, tribe: number, col: number, row: number) => number | undefined;
  readonly blessingRangeFor?: (typeId: number) => number | undefined;
  /** The held workshop's ship-water verdict at the hovered node, as the placement gates read it: `false`
   *  warns of a shop that builds no ships there and tints the ghost, `undefined` while the answer is on
   *  its way, `null` for a type that takes no verdict. Absent, the ghost asks for no verdict. */
  readonly shipWaterAt?: (
    typeId: number,
    tribe: number,
    col: number,
    row: number,
    owner?: number,
  ) => boolean | null | undefined;
  readonly canPlaceSignpostAt: (col: number, row: number) => boolean;
  readonly palisadePreview?: (tile: {
    readonly col: number;
    readonly row: number;
  }) => readonly LinePreviewNode[] | null;
  /** The road line's plots, or the cancel line's, under the cursor. */
  readonly roadPreview?: (tile: { readonly col: number; readonly row: number }) => RoadPreview | null;
  /** The gate tool's gate under the cursor, which draws in place of span markers. */
  readonly gatePreview?: (tile: { readonly col: number; readonly row: number }) => GatePreview | null;
  /** A line has its first click, so the preview's first node marks where it starts. */
  readonly anchored?: boolean;
  /** The line tools' wash: a started line's reach or the gate tool's spans, null when it has none. */
  readonly palisadeWash?: () => PlacementOverlayFrame | null;
  /** Owner slot for signpost and work-flag ghosts - the renderer applies the session colour mapping. */
  readonly localPlayer: number;
}

/**
 * The ghost stays hidden over ground that rejects it, matching the original's vanishing house cursor.
 * A held building takes precedence over a wall or road tool, those over a pending signpost, those over an armed
 * dock pick, whose wash of mooring spots stands the berth posts, and all of them over a pending work flag,
 * which has no wash: the sim snaps the flag to the nearest workable node on the click. With none of them,
 * selected ships still show where a right-click would moor them.
 */
export function placementCursor(input: PlacementCursorInput): PlacementCursor {
  const { building } = input;
  const palisadeGfxIndex = input.palisadeGfxIndex ?? null;
  if (input.roadActive === true) {
    // The wash stays while the pointer leaves the map; only the plots need a tile.
    const tile = input.tileAt();
    const plan = tile === null ? null : (input.roadPreview?.(tile) ?? null);
    return {
      overlay: input.palisadeWash?.() ?? null,
      ghost:
        plan === null
          ? null
          : {
              kind: 'line',
              nodes: plan.nodes,
              anchored: plan.anchored,
              marker: plan.cancel ? 'roadCancel' : 'road',
            },
    };
  }
  if (building === null && palisadeGfxIndex === null && !input.signpostActive) {
    if (input.dockVehicle !== null)
      return { overlay: input.dockOverlay(input.dockVehicle), ghost: berthGhost(input) };
    if (!input.flagActive) return { overlay: null, ghost: berthGhost(input) };
    const tile = input.tileAt();
    return {
      overlay: null,
      ghost:
        tile === null
          ? null
          : {
              kind: 'flag',
              col: tile.col,
              row: tile.row,
              player: input.localPlayer,
              ...(input.rallyActive === true ? { rally: true } : {}),
            },
    };
  }
  const signpostFrame = building === null && palisadeGfxIndex === null ? input.signpostOverlay() : null;
  const overlay = building === null ? signpostFrame : input.buildingOverlay(building);
  if (building === null && palisadeGfxIndex === null && signpostFrame === null)
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
  if (building !== null) {
    const { typeId, tribe } = building;
    if (!input.canPlaceAt(typeId, tribe, tile.col, tile.row, techWaived(building), probeOwner(building)))
      return { overlay, ghost: null };
    const defenceRangeNodes = input.defenceRangeAt?.(typeId, tribe, tile.col, tile.row);
    const blessingRangeNodes = input.blessingRangeFor?.(typeId);
    // The verdict rides the ghost that shows it: `false` tints the body and raises the chip beside it.
    const shipWater = input.shipWaterAt?.(typeId, tribe, tile.col, tile.row, probeOwner(building));
    const ghost: PlacementGhost = {
      kind: 'building',
      col: tile.col,
      row: tile.row,
      buildingType: typeId,
      tribe,
      ...(defenceRangeNodes === undefined ? {} : { defenceRangeNodes }),
      ...(blessingRangeNodes === undefined ? {} : { blessingRangeNodes }),
      ...(shipWater === false ? { warn: true } : {}),
    };
    return { overlay, ghost };
  }
  return input.canPlaceSignpostAt(tile.col, tile.row)
    ? { overlay, ghost: { kind: 'signpost', col: tile.col, row: tile.row, player: input.localPlayer } }
    : { overlay, ghost: null };
}

function berthGhost(input: PlacementCursorInput): PlacementGhost | null {
  const tile = input.berthsAt === undefined ? null : input.tileAt();
  const berths = tile === null ? [] : (input.berthsAt?.(tile) ?? []);
  return berths.length === 0 ? null : { kind: 'berths', berths };
}
