import type { Entity, Paper, PlayerCommand } from '@open-northland/sim';
import { messages } from '../../i18n/index.js';
import type { PlacementStrip } from '../dom/placement-strip.js';
import type { PanelContext } from './context.js';
import { type PalisadeLineNode, palisadeLine } from './palisade-line.js';

export type PalisadePlacementMode = 'wall' | 'gate';

export interface PalisadeGateProbeView {
  /** The orientation the sim picked for this node, or null when no authored row suits it. */
  readonly gfxIndex: number | null;
  readonly canConvert: boolean;
  readonly center: Entity | null;
  readonly span: readonly { readonly hx: number; readonly hy: number }[];
}

export type PalisadePlacementPreview =
  | {
      readonly kind: 'wall';
      readonly gfxIndex: number;
      readonly nodes: readonly (PalisadeLineNode & { readonly valid: boolean })[];
    }
  | {
      readonly kind: 'gate';
      readonly gfxIndex: number;
      readonly valid: boolean;
      readonly nodes: readonly PalisadeLineNode[];
    };

export interface PlacementDeps {
  readonly ctx: PanelContext;
  /** The strip that names the held building while placing. */
  readonly strip: PlacementStrip;
  /** typeId → display label for the strip. */
  readonly labelByType: ReadonlyMap<number, string>;
  /** Submit the `placeBuilding` command (the one-way seam). */
  readonly enqueue: (command: PlayerCommand) => void;
  /** Convert a client (CSS) point to a map tile, or `null` off the map - the placement target. */
  readonly screenToTile: (clientX: number, clientY: number) => { col: number; row: number } | null;
  /** The sim's live placement rule for the held type at a tile (`Simulation.placementProbe`); a click on
   *  a rejecting tile is inert, so build mode only ends on a placement that lands. */
  readonly canPlaceAt: (typeId: number, col: number, row: number, paper?: Paper) => boolean;
  readonly canPlacePalisadeAt?: (gfxIndex: number, col: number, row: number) => boolean;
  readonly palisadeGateProbe?: (gfxIndex: number, col: number, row: number) => PalisadeGateProbeView | null;
  /** The tribe + player a placed building belongs to. */
  readonly tribe: number;
  readonly owner: number;
  /** A placement was called off (Esc, the right button, a beam entry) with nothing placed; `paper`
   *  is the unspent plan it was to pay with, for the owner to take back into hand. */
  readonly onCancel?: (paper: Paper | null) => void;
}

/** Placement mode: pick a building in the window, then one left-click on buildable ground places and
 *  exits the mode, as in the original. Esc or right-click abandons. The landing click confirms through
 *  the GUI cue; the world itself makes no sound for a new site. A wall tool stays armed: each drag lays
 *  a line, and the gate tool cuts gates into finished runs until cancelled. */
export interface PlacementController {
  isActive(): boolean;
  /** The building typeId currently being placed, or null when not in placement. */
  activeType(): number | null;
  /** The paper paying for the active placement, or null for an ordinary construction site. */
  activePaper(): Paper | null;
  activePalisade(): number | null;
  activePalisadeMode(): PalisadePlacementMode | null;
  /** Hold `typeId` for placement; a `paper` rides the placement command and buys a finished building. */
  enter(typeId: number, paper?: Paper): void;
  enterPalisade(gfxIndex: number, label: string, mode?: PalisadePlacementMode): void;
  cancel(): void;
  /** Route a left-click while placing; a rejecting or off-map tile still consumes it, so a mis-click
   *  cannot drop the mode. Returns true when consumed. */
  handleClick(clientX: number, clientY: number): boolean;
  handleRelease(clientX: number, clientY: number): boolean;
  abortDrag(): void;
  palisadePreview(tile: PalisadeLineNode | null): PalisadePlacementPreview | null;
}

export function createPlacementController(deps: PlacementDeps): PlacementController {
  const { ctx, strip } = deps;

  let placementType: number | null = null;
  let palisadeGfxIndex: number | null = null;
  let palisadeMode: PalisadePlacementMode | null = null;
  let lineStart: PalisadeLineNode | null = null;
  let placementPaper: Paper | null = null;

  const exitPlacement = (): void => {
    placementType = null;
    palisadeGfxIndex = null;
    palisadeMode = null;
    lineStart = null;
    placementPaper = null;
    strip.clear();
  };

  const wallPreview = (
    gfxIndex: number,
    tile: PalisadeLineNode,
  ): Extract<PalisadePlacementPreview, { kind: 'wall' }> => ({
    kind: 'wall',
    gfxIndex,
    nodes: palisadeLine(lineStart ?? tile, tile).map((node) => ({
      ...node,
      valid: deps.canPlacePalisadeAt?.(gfxIndex, node.col, node.row) === true,
    })),
  });

  const gatePreview = (
    gfxIndex: number,
    tile: PalisadeLineNode,
  ): Extract<PalisadePlacementPreview, { kind: 'gate' }> | null => {
    const probe = deps.palisadeGateProbe?.(gfxIndex, tile.col, tile.row);
    if (probe == null || probe.span.length === 0) return null;
    return {
      kind: 'gate',
      gfxIndex: probe.gfxIndex ?? gfxIndex,
      valid: probe.canConvert,
      nodes: probe.span.map(({ hx, hy }) => ({ col: hx, row: hy })),
    };
  };

  return {
    isActive: () => placementType !== null || palisadeGfxIndex !== null,
    activeType: () => placementType,
    activePaper: () => placementPaper,
    activePalisade: () => palisadeGfxIndex,
    activePalisadeMode: () => palisadeMode,
    enter: (typeId, paper): void => {
      placementType = typeId;
      palisadeGfxIndex = null;
      palisadeMode = null;
      lineStart = null;
      placementPaper = paper ?? null;
      const copy = messages().hud.construction;
      strip.show({
        label: deps.labelByType.get(typeId) ?? `#${typeId}`,
        hint: paper === undefined ? copy.placeHint : copy.placePaperHint,
      });
    },
    enterPalisade: (gfxIndex, label, mode = 'wall'): void => {
      placementType = null;
      placementPaper = null;
      palisadeGfxIndex = gfxIndex;
      palisadeMode = mode;
      lineStart = null;
      const copy = messages().hud.construction;
      strip.show({ label, hint: mode === 'gate' ? copy.placeGateHint : copy.placeWallHint });
    },
    cancel: (): void => {
      if (placementType === null && palisadeGfxIndex === null) return;
      const paper = placementPaper;
      exitPlacement();
      deps.onCancel?.(paper);
    },
    handleClick: (clientX, clientY): boolean => {
      if (placementType === null && palisadeGfxIndex === null) return false;
      const tile = deps.screenToTile(clientX, clientY);
      if (palisadeGfxIndex !== null && palisadeMode === 'wall') {
        lineStart = tile;
        return true;
      }
      if (palisadeGfxIndex !== null && palisadeMode === 'gate') {
        const probe = tile === null ? null : deps.palisadeGateProbe?.(palisadeGfxIndex, tile.col, tile.row);
        if (probe?.canConvert === true && probe.center !== null && probe.gfxIndex !== null) {
          deps.enqueue({ kind: 'convertPalisadeGate', palisade: probe.center, gfxIndex: probe.gfxIndex });
          ctx.cue('confirm');
        }
        return true;
      }
      if (
        placementType !== null &&
        tile !== null &&
        deps.canPlaceAt(
          placementType,
          tile.col,
          tile.row,
          placementPaper === null ? undefined : placementPaper,
        )
      ) {
        deps.enqueue({
          kind: 'placeBuilding',
          buildingType: placementType,
          x: tile.col,
          y: tile.row,
          tribe: deps.tribe,
          owner: deps.owner,
          // The foundation stands at 0% and builders raise it, unless a paper pays for it finished.
          underConstruction: true,
          ...(placementPaper !== null ? { paper: placementPaper } : {}),
        });
        ctx.cue('confirm');
        exitPlacement();
      }
      return true;
    },
    /** Lay the dragged line up to the first node the placement probe rejects. */
    handleRelease: (clientX, clientY): boolean => {
      if (palisadeGfxIndex === null || palisadeMode !== 'wall' || lineStart === null) return false;
      const tile = deps.screenToTile(clientX, clientY);
      if (tile !== null) {
        const preview = wallPreview(palisadeGfxIndex, tile);
        let placed = 0;
        for (const node of preview.nodes) {
          if (!node.valid) break;
          deps.enqueue({
            kind: 'placePalisade',
            gfxIndex: palisadeGfxIndex,
            x: node.col,
            y: node.row,
            tribe: deps.tribe,
            owner: deps.owner,
            underConstruction: true,
          });
          placed++;
        }
        if (placed > 0) ctx.cue('confirm');
      }
      lineStart = null;
      return true;
    },
    abortDrag: (): void => {
      lineStart = null;
    },
    palisadePreview: (tile): PalisadePlacementPreview | null => {
      if (tile === null || palisadeGfxIndex === null) return null;
      return palisadeMode === 'gate'
        ? gatePreview(palisadeGfxIndex, tile)
        : wallPreview(palisadeGfxIndex, tile);
    },
  };
}
