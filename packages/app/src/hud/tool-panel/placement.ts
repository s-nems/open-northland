import type { Paper, PlayerCommand } from '@open-northland/sim';
import { messages } from '../../i18n/index.js';
import type { PlacementStrip } from '../dom/placement-strip.js';
import type { PanelContext } from './context.js';

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
  /** The tribe + player a placed building belongs to. */
  readonly tribe: number;
  readonly owner: number;
  /** A placement was called off (Esc, the right button, a beam entry) with nothing placed; `paper`
   *  is the unspent plan it was to pay with, for the owner to take back into hand. */
  readonly onCancel?: (paper: Paper | null) => void;
}

/** Placement mode: pick a building in the window, then one left-click on buildable ground places and
 *  exits the mode, as in the original. Esc or right-click abandons. The landing click confirms through
 *  the GUI cue; the world itself makes no sound for a new site. */
export interface PlacementController {
  isActive(): boolean;
  /** The building typeId currently being placed, or null when not in placement. */
  activeType(): number | null;
  /** The paper paying for the active placement, or null for an ordinary construction site. */
  activePaper(): Paper | null;
  activePalisade(): number | null;
  /** Hold `typeId` for placement; a `paper` rides the placement command and buys a finished building. */
  enter(typeId: number, paper?: Paper): void;
  /** Hold one source wall/gate graphics row. Successful clicks keep the tool armed for a chain. */
  enterPalisade(gfxIndex: number, label: string): void;
  cancel(): void;
  /** Route a left-click while placing; a rejecting or off-map tile still consumes it, so a mis-click
   *  cannot drop the mode. Returns true when consumed. */
  handleClick(clientX: number, clientY: number): boolean;
}

export function createPlacementController(deps: PlacementDeps): PlacementController {
  const { ctx, strip } = deps;

  let placementType: number | null = null;
  let palisadeGfxIndex: number | null = null;
  let placementPaper: Paper | null = null;

  const exitPlacement = (): void => {
    placementType = null;
    palisadeGfxIndex = null;
    placementPaper = null;
    strip.clear();
  };

  return {
    isActive: () => placementType !== null || palisadeGfxIndex !== null,
    activeType: () => placementType,
    activePaper: () => placementPaper,
    activePalisade: () => palisadeGfxIndex,
    enter: (typeId, paper): void => {
      placementType = typeId;
      palisadeGfxIndex = null;
      placementPaper = paper ?? null;
      const copy = messages().hud.construction;
      strip.show({
        label: deps.labelByType.get(typeId) ?? `#${typeId}`,
        hint: paper === undefined ? copy.placeHint : copy.placePaperHint,
      });
    },
    cancel: (): void => {
      if (placementType === null && palisadeGfxIndex === null) return;
      const paper = placementPaper;
      exitPlacement();
      deps.onCancel?.(paper);
    },
    enterPalisade: (gfxIndex, label): void => {
      placementType = null;
      placementPaper = null;
      palisadeGfxIndex = gfxIndex;
      strip.show({ label, hint: messages().hud.construction.placeRepeatHint });
    },
    handleClick: (clientX, clientY): boolean => {
      if (placementType === null && palisadeGfxIndex === null) return false;
      const tile = deps.screenToTile(clientX, clientY);
      if (
        palisadeGfxIndex !== null &&
        tile !== null &&
        deps.canPlacePalisadeAt?.(palisadeGfxIndex, tile.col, tile.row) === true
      ) {
        deps.enqueue({
          kind: 'placePalisade',
          gfxIndex: palisadeGfxIndex,
          x: tile.col,
          y: tile.row,
          tribe: deps.tribe,
          owner: deps.owner,
          underConstruction: true,
        });
        ctx.cue('confirm');
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
  };
}
