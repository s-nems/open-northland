import type { Paper, PlayerCommand } from '@open-northland/sim';
import type { Container } from 'pixi.js';
import { formatMessage, messages } from '../../i18n/index.js';
import type { PanelContext } from './context.js';
import { createHeldItemBanner } from './held-item-banner.js';

export interface PlacementDeps {
  readonly ctx: PanelContext;
  /** The panel's banner container (drawn over the windows). */
  readonly container: Container;
  /** typeId → display label for the banner text. */
  readonly labelByType: ReadonlyMap<number, string>;
  /** Submit the `placeBuilding` command (the one-way seam). */
  readonly enqueue: (command: PlayerCommand) => void;
  /** Convert a client (CSS) point to a map tile, or `null` off the map - the placement target. */
  readonly screenToTile: (clientX: number, clientY: number) => { col: number; row: number } | null;
  /** The sim's live placement rule for the held type at a tile (`Simulation.placementProbe`); a click on
   *  a rejecting tile is inert, so build mode only ends on a placement that lands. */
  readonly canPlaceAt: (typeId: number, col: number, row: number, paper?: Paper) => boolean;
  /** The tribe + player a placed building belongs to. */
  readonly tribe: number;
  readonly owner: number;
}

/** Placement mode: pick a building in the menu, then one left-click on buildable ground places and
 *  exits the mode, as in the original. Esc or right-click abandons. */
export interface PlacementController {
  isActive(): boolean;
  /** The building typeId currently being placed, or null when not in placement. */
  activeType(): number | null;
  /** The paper paying for the active placement, or null for an ordinary construction site. */
  activePaper(): Paper | null;
  /** Hold `typeId` for placement; a `paper` rides the placement command and buys a finished building. */
  enter(typeId: number, paper?: Paper): void;
  cancel(): void;
  /** Route a left-click while placing; a rejecting or off-map tile still consumes it, so a mis-click
   *  cannot drop the mode. Returns true when consumed. */
  handleClick(clientX: number, clientY: number): boolean;
  /** Per-frame: re-place the banner text against the live canvas size. */
  placeBanner(): void;
}

export function createPlacementController(deps: PlacementDeps): PlacementController {
  const { ctx } = deps;

  let placementType: number | null = null;
  let placementPaper: Paper | null = null;
  const banner = createHeldItemBanner(ctx, deps.container);

  const exitPlacement = (): void => {
    placementType = null;
    placementPaper = null;
    banner.clear();
  };

  return {
    isActive: () => placementType !== null,
    activeType: () => placementType,
    activePaper: () => placementPaper,
    enter: (typeId, paper): void => {
      placementType = typeId;
      placementPaper = paper ?? null;
      const label = deps.labelByType.get(typeId) ?? `#${typeId}`;
      const hint = paper === undefined ? messages().hud.placementHint : messages().hud.placementPaperHint;
      banner.show(formatMessage(hint, { label }));
    },
    cancel: exitPlacement,
    handleClick: (clientX, clientY): boolean => {
      if (placementType === null) return false;
      const tile = deps.screenToTile(clientX, clientY);
      if (
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
        exitPlacement();
      }
      return true;
    },
    placeBanner: () => banner.place(),
  };
}
