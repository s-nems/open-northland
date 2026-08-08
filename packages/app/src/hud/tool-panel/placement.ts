import type { PlayerCommand } from '@open-northland/sim';
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
  /** The sim's live placement rule for the held type at a tile (`Simulation.placementProbe`). A click on
   *  a rejecting tile is inert, as in the original, so build mode only ends on a placement that lands. */
  readonly canPlaceAt: (typeId: number, col: number, row: number) => boolean;
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
  enter(typeId: number): void;
  cancel(): void;
  /**
   * Route a left-click while placing: an accepted tile enqueues `placeBuilding` as a construction site and
   * exits build mode, while a rejecting or off-map tile consumes the click but does nothing. Returns true
   * when consumed.
   */
  handleClick(clientX: number, clientY: number): boolean;
  /** Per-frame: re-place the banner text against the live canvas size. */
  placeBanner(): void;
}

/** Build the placement controller: the mode flag, the "klik: postaw, Esc: anuluj" banner, and the drop. */
export function createPlacementController(deps: PlacementDeps): PlacementController {
  const { ctx } = deps;

  let placementType: number | null = null;
  const banner = createHeldItemBanner(ctx, deps.container);

  /** Leave build mode: clear the flag + banner (shared by cancel and a landed placement). */
  const exitPlacement = (): void => {
    placementType = null;
    banner.clear();
  };

  return {
    isActive: () => placementType !== null,
    activeType: () => placementType,
    enter: (typeId): void => {
      placementType = typeId;
      const label = deps.labelByType.get(typeId) ?? `#${typeId}`;
      banner.show(formatMessage(messages().hud.placementHint, { label }));
    },
    cancel: exitPlacement,
    handleClick: (clientX, clientY): boolean => {
      if (placementType === null) return false;
      const tile = deps.screenToTile(clientX, clientY);
      // Placement claims every click, so the mode survives a mis-click on the dimmed wash.
      if (tile !== null && deps.canPlaceAt(placementType, tile.col, tile.row)) {
        deps.enqueue({
          kind: 'placeBuilding',
          buildingType: placementType,
          x: tile.col,
          y: tile.row,
          tribe: deps.tribe,
          owner: deps.owner,
          // A construction site, not a finished building: the foundation stands at 0% and builders raise it.
          underConstruction: true,
        });
        exitPlacement();
      }
      return true;
    },
    placeBanner: () => banner.place(),
  };
}
